const Firebird = require('node-firebird');
const fs = require('fs');
const path = require('path');
const os = require('os');

// Configuracao: variaveis de ambiente ou config/db.json (nao versionar credenciais)
let fileCfg = {};
try {
    const cfgPath = path.join(process.env.CONFIG_DIR || path.join(__dirname, '..', 'config'), 'db.json');
    if (fs.existsSync(cfgPath)) fileCfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
} catch (e) {
    console.warn('Erro ao ler config/db.json:', e.message);
}
// Padrao: pasta OneDrive do usuario atual (o caminho antigo fixava "Walter Gravina")
const DEFAULT_DB_FILE = path.join(os.homedir(), 'OneDrive', 'DADOS', 'DUSUCO', 'DADOS.FDB');
const DB_CONN = process.env.FB_DB_CONN || fileCfg.dbConn || `localhost/3060:${DEFAULT_DB_FILE}`;
const DB_USER = process.env.FB_USER || fileCfg.user || 'SYSDBA';
const DB_PASS = process.env.FB_PASSWORD || fileCfg.password || 'masterkey';
const DB_POOL = parseInt(process.env.FB_POOL || fileCfg.pool || '5', 10);

const cacheDir = process.env.CACHE_DIR || path.join(__dirname, '..', 'cache');
if (!fs.existsSync(cacheDir)) {
    fs.mkdirSync(cacheDir, { recursive: true });
}

// Lock de alto nivel: serializa operacoes "le + grava" (IDs/sequenciais) entre requisicoes
let txQueue = Promise.resolve();
function withLock(fn) {
    const run = txQueue.then(fn);
    txQueue = run.catch(() => {});
    return run;
}

// O banco usa charset NONE e guarda texto em Windows-1252 (confirmado: bytes C7/C3 em "AÇAI").
// Entrada e saida do isql precisam ser tratadas como win1252, nao UTF-8.
const WIN1252_DECODER = new TextDecoder('windows-1252');
const WIN1252_EXTRA = { 0x20AC: 0x80, 0x201A: 0x82, 0x0192: 0x83, 0x201E: 0x84, 0x2026: 0x85, 0x2020: 0x86, 0x2021: 0x87,
    0x02C6: 0x88, 0x2030: 0x89, 0x0160: 0x8A, 0x2039: 0x8B, 0x0152: 0x8C, 0x017D: 0x8E, 0x2018: 0x91, 0x2019: 0x92,
    0x201C: 0x93, 0x201D: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97, 0x02DC: 0x98, 0x2122: 0x99, 0x0161: 0x9A,
    0x203A: 0x9B, 0x0153: 0x9C, 0x017E: 0x9E, 0x0178: 0x9F };
function encodeWin1252(str) {
    const out = [];
    for (const ch of str) {
        const c = ch.codePointAt(0);
        if (c < 0x80 || (c >= 0xA0 && c <= 0xFF)) out.push(c);
        else if (WIN1252_EXTRA[c] !== undefined) out.push(WIN1252_EXTRA[c]);
        else out.push(0x3F); // '?'
    }
    return Buffer.from(out);
}

// Erro com codigo HTTP (validacao = 400, nao encontrado = 404)
function httpError(status, message) {
    const e = new Error(message);
    e.status = status;
    return e;
}

// --- Helpers de saneamento SQL ---
function sqlStr(v, max = 255) {
    return String(v === null || v === undefined ? '' : v).replace(/'/g, "''").replace(/\u0000/g, '').substring(0, max);
}
function sqlDate(v) {
    if (v === null || v === undefined || v === '') return null;
    const m = String(v).match(/^(\d{4})-(\d{2})-(\d{2})(?:$|[T ])/);
    if (!m || +m[2] < 1 || +m[2] > 12 || +m[3] < 1 || +m[3] > 31) throw httpError(400, 'Data inválida');
    return `${m[1]}-${m[2]}-${m[3]}`;
}
function sqlNum(v, label = 'Valor') {
    const n = parseFloat(v);
    if (!isFinite(n)) throw new Error(`${label} inválido`);
    return n;
}
// Escapa curingas do LIKE (usar com ESCAPE '\')
function sqlLike(v) {
    return sqlStr(v).toUpperCase().replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}


// ---------------------------------------------------------------------------
// Camada de acesso ao Firebird (driver node-firebird com pool de conexoes)
// ---------------------------------------------------------------------------

// "host/porta:caminho" (formato do isql) ou apenas "C:\\caminho\\DADOS.FDB"
function parseConn(conn) {
    const c = String(conn);
    if (/^[A-Za-z]:[\\/]/.test(c)) return { host: 'localhost', port: 3050, database: c };
    const m = c.match(/^([^/:]+)(?:\/(\d+))?:(.+)$/);
    if (!m) return { host: 'localhost', port: 3050, database: c };
    return { host: m[1], port: m[2] ? parseInt(m[2], 10) : 3050, database: m[3] };
}

const connInfo = parseConn(DB_CONN);
const fbOptions = {
    host: connInfo.host,
    port: connInfo.port,
    database: connInfo.database,
    user: DB_USER,
    password: DB_PASS,
    encoding: 'WIN1252',   // o banco usa charset NONE com texto em Windows-1252
    lowercase_keys: false,
    role: null,
    pageSize: 4096
};

// --- Configuracao do banco editavel em tempo de execucao (tela do servidor) ---
const CFG_PATH = path.join(process.env.CONFIG_DIR || path.join(__dirname, '..', 'config'), 'db.json');

function getDbConfig() {
    return {
        host: fbOptions.host,
        port: fbOptions.port,
        database: fbOptions.database,
        user: fbOptions.user,
        hasPassword: !!fbOptions.password
    };
}

function normalizeDbConfig(input, current) {
    const host = String((input && input.host) || '').trim();
    const database = String((input && input.database) || '').trim();
    const port = parseInt(input && input.port, 10);
    if (!host) throw httpError(400, 'Informe o host');
    if (!database) throw httpError(400, 'Informe o caminho da base');
    if (!(port > 0 && port < 65536)) throw httpError(400, 'Porta inválida');
    const user = String((input && input.user) || '').trim() || current.user;
    // senha vazia = mantem a atual
    const password = input && input.password ? String(input.password) : current.password;
    return { host, port, database, user, password };
}

function testDbConfig(input) {
    const c = normalizeDbConfig(input, fbOptions);
    return new Promise((resolve, reject) => {
        let done = false;
        const timer = setTimeout(() => {
            if (!done) { done = true; reject(httpError(400, 'Tempo esgotado ao conectar (10s)')); }
        }, 10000);
        Firebird.attach({ ...fbOptions, ...c }, (err, conn) => {
            if (done) { if (conn) { try { conn.detach(); } catch (e) { /* ignora */ } } return; }
            done = true;
            clearTimeout(timer);
            if (err) return reject(httpError(400, 'Falha ao conectar: ' + err.message));
            conn.query('SELECT 1 FROM RDB$DATABASE', [], (qErr) => {
                try { conn.detach(); } catch (e) { /* ignora */ }
                if (qErr) return reject(httpError(400, 'Conectou, mas a consulta falhou: ' + qErr.message));
                resolve({ ok: true });
            });
        });
    });
}

async function saveDbConfig(input) {
    const c = normalizeDbConfig(input, fbOptions);
    await testDbConfig(input);
    let file = {};
    try { if (fs.existsSync(CFG_PATH)) file = JSON.parse(fs.readFileSync(CFG_PATH, 'utf8')); } catch (e) { /* recria */ }
    file.dbConn = `${c.host}/${c.port}:${c.database}`;
    file.user = c.user;
    file.password = c.password;
    fs.mkdirSync(path.dirname(CFG_PATH), { recursive: true });
    fs.writeFileSync(CFG_PATH, JSON.stringify(file, null, 2), 'utf8');
    Object.assign(fbOptions, c);
    resetPool();
    return getDbConfig();
}

let pool = null;
function getPool() {
    if (!pool) pool = Firebird.pool(DB_POOL, fbOptions);
    return pool;
}
function resetPool() {
    const old = pool;
    pool = null;
    try { if (old) old.destroy(); } catch (e) { /* ignora */ }
}

const CONN_ERR_RE = /ECONNRESET|ECONNREFUSED|EPIPE|ETIMEDOUT|socket|connection (lost|closed|reset)|network|Unable to complete|Error reading data from the connection|not connected/i;

function wrapDbError(err) {
    if (err && err.status) return err;
    const msg = err && err.message ? err.message : String(err);
    const e = new Error('Erro Firebird: ' + msg);
    e.cause = err;
    return e;
}

// Executa fn(db) com uma conexao do pool; tenta de novo uma vez se a conexao caiu.
async function withConn(fn, retry = true) {
    let db;
    try {
        db = await new Promise((resolve, reject) => getPool().get((err, d) => (err ? reject(err) : resolve(d))));
    } catch (err) {
        if (retry && CONN_ERR_RE.test(String(err && err.message))) { resetPool(); return withConn(fn, false); }
        throw wrapDbError(err);
    }
    try {
        return await fn(db);
    } catch (err) {
        if (retry && CONN_ERR_RE.test(String(err && err.message))) {
            try { db.detach(); } catch (e) { /* ignora */ }
            db = null;
            resetPool();
            return withConn(fn, false);
        }
        throw wrapDbError(err);
    } finally {
        if (db) { try { db.detach(); } catch (e) { /* ignora */ } }
    }
}

function readBlob(blobFn) {
    return new Promise((resolve, reject) => {
        blobFn((err, name, stream) => {
            if (err) return reject(err);
            if (!stream) return resolve(Buffer.alloc(0));
            const chunks = [];
            stream.on('data', (c) => chunks.push(c));
            stream.on('end', () => resolve(Buffer.concat(chunks)));
            stream.on('error', reject);
        });
    });
}

const two = (n) => String(n).padStart(2, '0');
function formatDate(d) {
    const ymd = `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`;
    if (d.getHours() === 0 && d.getMinutes() === 0 && d.getSeconds() === 0 && d.getMilliseconds() === 0) return ymd;
    return `${ymd} ${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}.${String(d.getMilliseconds()).padStart(3, '0')}`;
}

// Normaliza para o formato que o restante do codigo ja espera (valores em texto, NULL = null)
function normValue(v) {
    if (v === null || v === undefined) return null;
    if (v instanceof Date) return formatDate(v);
    if (Buffer.isBuffer(v)) return v.toString('hex').toUpperCase(); // CHARACTER SET OCTETS -> hex
    if (typeof v === 'function') return null; // BLOB nao lido (use rawQuery)
    if (typeof v === 'string') return v.replace(/\s+$/, '');
    return String(v);
}
function normRow(row) {
    const out = {};
    for (const k of Object.keys(row)) out[k] = normValue(row[k]);
    return out;
}

// Consulta sem normalizar. Com blobs: true, le os campos BLOB para Buffer antes de liberar a conexao.
function rawQuery(sql, params = [], { blobs = false } = {}) {
    return withConn((db) => new Promise((resolve, reject) => {
        db.query(sql, params, async (err, rows) => {
            if (err) return reject(err);
            rows = rows || [];
            if (blobs) {
                try {
                    for (const row of rows) {
                        for (const k of Object.keys(row)) {
                            if (typeof row[k] === 'function') row[k] = await readBlob(row[k]);
                        }
                    }
                } catch (e) { return reject(e); }
            }
            resolve(rows);
        });
    }));
}

async function query(sql, params = []) {
    const rows = await rawQuery(sql, params);
    return rows.map(normRow);
}

// Divide um script em comandos respeitando literais '...' e identificadores "...".
function splitStatements(script) {
    const out = [];
    let cur = '';
    let quote = null;
    const src = String(script);
    for (let i = 0; i < src.length; i++) {
        const c = src[i];
        if (quote) {
            cur += c;
            if (c === quote) {
                if (src[i + 1] === quote) { cur += src[++i]; } else { quote = null; }
            }
        } else if (c === "'" || c === '"') {
            quote = c;
            cur += c;
        } else if (c === ';') {
            if (cur.trim()) out.push(cur.trim());
            cur = '';
        } else {
            cur += c;
        }
    }
    if (cur.trim()) out.push(cur.trim());
    return out;
}

// Executa varios comandos (strings SQL ou { sql, params }) numa unica transacao.
// Qualquer erro desfaz tudo (rollback).
function runStatements(statements) {
    return withConn((db) => new Promise((resolve, reject) => {
        db.transaction(Firebird.ISOLATION_READ_COMMITTED, (err, tr) => {
            if (err) return reject(err);
            (async () => {
                try {
                    for (const st of statements) {
                        const sql = typeof st === 'string' ? st : st.sql;
                        const params = typeof st === 'string' ? [] : (st.params || []);
                        await new Promise((res, rej) => tr.query(sql, params, (e) => (e ? rej(e) : res())));
                    }
                } catch (e) {
                    return tr.rollback(() => reject(e));
                }
                tr.commit((e) => (e ? reject(e) : resolve()));
            })();
        });
    }));
}

// Compatibilidade com o codigo existente: recebe um "script" (com ; e COMMIT/EXIT/SET opcionais)
async function runScript(script) {
    const statements = splitStatements(script).filter((st) => !/^(COMMIT|EXIT|ROLLBACK|SET\s+[\s\S]*)$/i.test(st));
    if (statements.length === 0) return;
    await runStatements(statements);
}
const executeIsqlScript = runScript;

function execute(sql) {
    return runScript(sql);
}

// --- Audit Helper ---
// O ERP grava a auditoria com descricao de campo propria, datas dd/mm/aaaa, status como codigo (A/P/I)
// e numeros sem zeros a direita. Normalizar aqui mantem as telas de auditoria do ERP coerentes.
const AUD_CAMPO_DESC = {
    PRD_STATUS: 'Status', PRD_PRECO_VENDA: 'Preço Venda', PRD_PRECO_MINIMO: 'Preço Mínimo',
    PRD_VALOR_PROM: 'Preço Promoção', PRD_DT_INI_PROM: 'Data Inicio Promoção', PRD_DT_FIM_PROM: 'Data Fim Promoção',
    PRD_TIPO_VALOR_PROM: 'Tipo Valor Promoção', PRD_UN_VENDA: 'Unidade Principal', PRD_DESCRICAO: 'Descrição',
    PRD_OBSERVACAO: 'Observação'
};
const AUD_TABELA_DESC = { TB_PRODUTO: 'PRODUTOS', TB_PRODUTO_ESTOQUE: 'ESTOQUE DO PRODUTO' };
function audValor(campo, v) {
    if (v === null || v === undefined) return '';
    const t = String(v).trim();
    if (t === '') return '';
    if (/^PRD_DT_(INI|FIM)_PROM$/.test(campo)) {
        const m = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
        return m ? `${m[3]}/${m[2]}/${m[1]}` : t;
    }
    if (campo === 'PRD_STATUS') return /^ativo$/i.test(t) ? 'A' : (/^inativo$/i.test(t) ? 'I' : t);
    if (/^(PRD_PRECO_VENDA|PRD_PRECO_MINIMO|PRD_VALOR_PROM)$/.test(campo) && isFinite(parseFloat(t))) return String(parseFloat(t));
    if (campo === 'PRD_VALOR_PROM' && (/desativ/i.test(t) || parseFloat(t) === 0)) return '';
    return t;
}
async function logAudit({ empresa = 1, tabela = 'TB_PRODUTO', idRegistro, acao = 'A', descRegistro = '', usuario = 1, changes = [] }) {
    if (!changes || changes.length === 0) return;

    const safeDesc = sqlStr(descRegistro, 200);
    const safeTabela = sqlStr(tabela, 50);
    const safeId = sqlStr(idRegistro, 50);
    const safeAcao = sqlStr(acao, 1);
    const emp = parseInt(empresa, 10) || 1;
    const usr = parseInt(usuario, 10) || 1;

    // A alteracao principal ja foi gravada quando chegamos aqui: uma falha de auditoria
    // e registrada, mas nao transforma a resposta em erro (evitaria reenvio duplicado).
    return withLock(async () => {
      try {
        // O UPDATE vem primeiro: trava a linha do sequencial e o valor lido abaixo
        // (na mesma transacao) e unico, mesmo com outro cliente (ERP) gravando junto.
        const seqSel = `(SELECT SEQ_SEQUENCIAL FROM TB_SEQUENCIAL WHERE SEQ_TABELA = 'TB_AUDITORIA')`;
        let script = `
UPDATE TB_SEQUENCIAL SET SEQ_SEQUENCIAL = SEQ_SEQUENCIAL + 1 WHERE SEQ_TABELA = 'TB_AUDITORIA';
INSERT INTO TB_AUDITORIA (AUD_EMPRESA, AUD_TABELA, AUD_ID_REGISTRO, AUD_SEQUENCIA, AUD_TABELA_DESC, AUD_ACAO, AUD_DT_LANCAMENTO, AUD_DT_ACAO, AUD_USUARIO, AUD_DESC_REGISTRO, AUD_VERSAO, AUD_VERSAO_SERVIDOR)
VALUES (${emp}, '${safeTabela}', '${safeId}', ${seqSel}, '${sqlStr(AUD_TABELA_DESC[tabela] || tabela, 50)}', '${safeAcao}', CURRENT_TIMESTAMP, CURRENT_DATE, ${usr}, '${safeDesc}', 'Upweb', 'Upweb');
`;

        for (const chg of changes) {
            const campo = sqlStr(chg.campo, 50);
            const campoDesc = sqlStr(AUD_CAMPO_DESC[chg.campo] || chg.campoDesc || chg.campo, 80);
            const vAntigo = sqlStr(audValor(chg.campo, chg.antigo), 200);
            const vNovo = sqlStr(audValor(chg.campo, chg.novo), 200);

            script += `
INSERT INTO TB_AUDITORIA_ITEM (AUDI_EMPRESA, AUDI_TABELA, AUDI_ID_REGISTRO, AUDI_AUDITORIA, AUDI_CAMPO, AUDI_CAMPO_DESC, AUDI_VALOR_ANTIGO, AUDI_VALOR_NOVO)
VALUES (${emp}, '${safeTabela}', '${safeId}', ${seqSel}, '${campo}', '${campoDesc}', '${vAntigo}', '${vNovo}');
`;
        }

        script += `\nCOMMIT;\nEXIT;\n`;
        await executeIsqlScript(script);
      } catch (err) {
        console.error(`[AUDITORIA] Falha ao gravar auditoria de ${safeTabela} #${safeId}: ${err.message}`);
        return false;
      }
    });
}

// Campos BLOB (subtype 0) chegam como hexadecimal (CHARACTER SET OCTETS); decodifica como win1252
function hexToWin1252(hex) {
    if (!hex) return '';
    const h = String(hex).replace(/\s+/g, '');
    if (!/^([0-9A-Fa-f]{2})+$/.test(h)) return String(hex); // nao era hex: devolve como veio
    return WIN1252_DECODER.decode(Buffer.from(h, 'hex')).replace(/\0+$/, '').trim();
}

// Promocao vigente: valor > 0 e hoje dentro de [inicio, fim] (datas 'YYYY-MM-DD'; vazio = sem limite)
function isPromoVigente(valorProm, dtIni, dtFim) {
    if (!(valorProm > 0)) return false;
    const d = new Date();
    const hoje = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const ini = dtIni ? String(dtIni).substring(0, 10) : null;
    const fim = dtFim ? String(dtFim).substring(0, 10) : null;
    if (ini && ini > hoje) return false;
    if (fim && fim < hoje) return false;
    return true;
}

// --- Product Queries ---
// Filtering PRD_TIPO_PRODUTO IN ('N', 'P', 'T') (Normal, Produzido, Transformado/Bebidas)
async function getProducts({ search = '', status = 'TODOS', promo = 'TODOS', stock = 'TODOS', sort = 'PADRAO', page = 1, pageSize = 24 }) {
    let whereClauses = ["P.PRD_TIPO_PRODUTO IN ('N', 'P', 'T')"];

    if (search && search.trim() !== '') {
        const term = sqlLike(search.trim());
        whereClauses.push(`(UPPER(P.PRD_DESCRICAO) LIKE '%${term}%' ESCAPE '\\' OR P.PRD_CODIGO LIKE '%${term}%' ESCAPE '\\' OR UPPER(P.PRD_REFERENCIA) LIKE '%${term}%' ESCAPE '\\')`);
    }

    if (status === 'ATIVOS') {
        whereClauses.push(`P.PRD_STATUS IN ('A', 'P')`);
    } else if (status === 'INATIVOS') {
        whereClauses.push(`P.PRD_STATUS = 'I'`);
    }

    if (promo === 'EM_PROMOCAO') {
        whereClauses.push(`(P.PRD_VALOR_PROM IS NOT NULL AND P.PRD_VALOR_PROM > 0 AND (P.PRD_DT_INI_PROM IS NULL OR P.PRD_DT_INI_PROM <= CURRENT_DATE) AND (P.PRD_DT_FIM_PROM IS NULL OR P.PRD_DT_FIM_PROM >= CURRENT_DATE))`);
    } else if (promo === 'REGULAR') {
        whereClauses.push(`NOT (P.PRD_VALOR_PROM IS NOT NULL AND P.PRD_VALOR_PROM > 0 AND (P.PRD_DT_INI_PROM IS NULL OR P.PRD_DT_INI_PROM <= CURRENT_DATE) AND (P.PRD_DT_FIM_PROM IS NULL OR P.PRD_DT_FIM_PROM >= CURRENT_DATE))`);
    }

    if (stock === 'BAIXO') {
        whereClauses.push(`COALESCE(E.PRDE_ESTOQUE, 0) <= 5`);
    } else if (stock === 'SEM_ESTOQUE') {
        whereClauses.push(`COALESCE(E.PRDE_ESTOQUE, 0) <= 0`);
    } else if (stock === 'NORMAL') {
        whereClauses.push(`COALESCE(E.PRDE_ESTOQUE, 0) > 5`);
    }

    const whereStr = whereClauses.join(' AND ');
    page = Math.max(1, parseInt(page, 10) || 1);
    pageSize = Math.min(200, Math.max(1, parseInt(pageSize, 10) || 24));
    const offset = (page - 1) * pageSize;

    let orderByClause = "(CASE WHEN (P.PRD_FOTO IS NOT NULL AND TRIM(P.PRD_FOTO) <> '') OR P.PRD_IMAGEM IS NOT NULL THEN 0 ELSE 1 END), P.PRD_ID DESC";
    if (sort === 'MAIS_RECENTES') {
        orderByClause = "P.PRD_ID DESC";
    } else if (sort === 'PRECO_ASC') {
        orderByClause = "P.PRD_PRECO_VENDA ASC, P.PRD_ID DESC";
    } else if (sort === 'PRECO_DESC') {
        orderByClause = "P.PRD_PRECO_VENDA DESC, P.PRD_ID DESC";
    } else if (sort === 'ESTOQUE_ASC') {
        orderByClause = "COALESCE(E.PRDE_ESTOQUE, 0) ASC, P.PRD_ID DESC";
    } else if (sort === 'ESTOQUE_DESC') {
        orderByClause = "COALESCE(E.PRDE_ESTOQUE, 0) DESC, P.PRD_ID DESC";
    } else if (sort === 'NOME_ASC') {
        orderByClause = "P.PRD_DESCRICAO ASC, P.PRD_ID DESC";
    } else if (sort === 'MARGEM_DESC' || sort === 'MARGEM_ASC') {
        // margem % = (venda - compra) / venda; sem custo informado vai para o fim da lista
        const margem = '(CASE WHEN (P.PRD_PRECO_COMPRA > 0 AND P.PRD_PRECO_VENDA > 0) THEN ((P.PRD_PRECO_VENDA - P.PRD_PRECO_COMPRA) / P.PRD_PRECO_VENDA) ELSE NULL END)';
        orderByClause = `(CASE WHEN ${margem} IS NULL THEN 1 ELSE 0 END), ${margem} ${sort === 'MARGEM_DESC' ? 'DESC' : 'ASC'}, P.PRD_ID DESC`;
    } else if (sort === 'DESCONTO_DESC') {
        orderByClause = "(CASE WHEN (P.PRD_VALOR_PROM > 0 AND P.PRD_PRECO_VENDA > 0) THEN ((P.PRD_PRECO_VENDA - P.PRD_VALOR_PROM) / P.PRD_PRECO_VENDA) ELSE 0 END) DESC, P.PRD_ID DESC";
    }

    // Count
    const countRows = await query(`
SELECT COUNT(*) AS TOTAL 
FROM TB_PRODUTO P 
LEFT JOIN TB_PRODUTO_ESTOQUE E ON (E.PRDE_PRODUTO = P.PRD_ID AND E.PRDE_EMPRESA = 1)
WHERE ${whereStr}
`);
    const total = countRows.length > 0 ? parseInt(countRows[0].TOTAL, 10) : 0;

    // Query items with stock, prices, and photo flag (checking PRD_FOTO and PRD_IMAGEM)
    const sql = `
SELECT FIRST ${pageSize} SKIP ${offset}
    P.PRD_ID,
    P.PRD_CODIGO,
    P.PRD_DESCRICAO,
    P.PRD_STATUS,
    P.PRD_UN_VENDA,
    P.PRD_REFERENCIA,
    P.PRD_TIPO_PRODUTO,
    P.PRD_PRECO_VENDA,
    P.PRD_PRECO_COMPRA,
    P.PRD_PRECO_MINIMO,
    P.PRD_VALOR_PROM,
    P.PRD_DT_INI_PROM,
    P.PRD_DT_FIM_PROM,
    P.PRD_TIPO_VALOR_PROM,
    P.PRD_ULTIMA_ALTERACAO,
    P.PRD_FOTO,
    COALESCE(E.PRDE_ESTOQUE, 0) AS ESTOQUE,
    COALESCE(E.PRDE_ESTOQUE_NF, 0) AS ESTOQUE_NF,
    (CASE WHEN (P.PRD_FOTO IS NOT NULL AND TRIM(P.PRD_FOTO) <> '') OR P.PRD_IMAGEM IS NOT NULL THEN 1 ELSE 0 END) AS TEM_FOTO
FROM TB_PRODUTO P
LEFT JOIN TB_PRODUTO_ESTOQUE E ON (E.PRDE_PRODUTO = P.PRD_ID AND E.PRDE_EMPRESA = 1)
WHERE ${whereStr}
ORDER BY ${orderByClause}
`;

    const items = await query(sql);

    const formattedItems = items.map(p => {
        const precoVenda = parseFloat(p.PRD_PRECO_VENDA) || 0;
        const precoProm = parseFloat(p.PRD_VALOR_PROM) || 0;
        const precoCompra = parseFloat(p.PRD_PRECO_COMPRA) || 0;
        const estoque = parseFloat(p.ESTOQUE) || 0;
        const emPromocao = isPromoVigente(precoProm, p.PRD_DT_INI_PROM, p.PRD_DT_FIM_PROM);
        const descontoPercentual = emPromocao && precoVenda > 0 ? Math.round(((precoVenda - precoProm) / precoVenda) * 100) : 0;

        return {
            id: parseInt(p.PRD_ID, 10),
            codigo: p.PRD_CODIGO || '',
            descricao: p.PRD_DESCRICAO || '',
            status: p.PRD_STATUS || 'A',
            unidade: p.PRD_UN_VENDA || 'UN',
            referencia: p.PRD_REFERENCIA || '',
            tipoProduto: p.PRD_TIPO_PRODUTO || 'N',
            fotoPath: p.PRD_FOTO || '',
            precoVenda,
            precoCompra,
            precoMinimo: parseFloat(p.PRD_PRECO_MINIMO) || 0,
            precoPromocao: precoProm,
            dtInicioProm: p.PRD_DT_INI_PROM || null,
            dtFimProm: p.PRD_DT_FIM_PROM || null,
            tipoValorProm: p.PRD_TIPO_VALOR_PROM || 'V',
            emPromocao,
            descontoPercentual,
            estoque,
            estoqueNf: parseFloat(p.ESTOQUE_NF) || 0,
            temFoto: p.TEM_FOTO === '1',
            ultimaAlteracao: p.PRD_ULTIMA_ALTERACAO
        };
    });

    return {
        total,
        page,
        pageSize,
        totalPages: Math.ceil(total / pageSize),
        items: formattedItems
    };
}

async function getProductById(id) {
    const sql = `
SELECT 
    P.PRD_ID,
    P.PRD_CODIGO,
    P.PRD_DESCRICAO,
    P.PRD_STATUS,
    P.PRD_UN_VENDA,
    P.PRD_REFERENCIA,
    P.PRD_TIPO_PRODUTO,
    P.PRD_PRECO_VENDA,
    P.PRD_PRECO_COMPRA,
    P.PRD_PRECO_MINIMO,
    P.PRD_VALOR_PROM,
    P.PRD_DT_INI_PROM,
    P.PRD_DT_FIM_PROM,
    P.PRD_TIPO_VALOR_PROM,
    P.PRD_ULTIMA_ALTERACAO,
    P.PRD_ESTOQUE_MINIMO_NF,
    CAST(SUBSTRING(P.PRD_OBSERVACAO FROM 1 FOR 4000) AS VARCHAR(4000) CHARACTER SET OCTETS) AS PRD_OBSERVACAO,
    P.PRD_FOTO,
    COALESCE(E.PRDE_ESTOQUE, 0) AS ESTOQUE,
    COALESCE(E.PRDE_ESTOQUE_NF, 0) AS ESTOQUE_NF,
    (CASE WHEN (P.PRD_FOTO IS NOT NULL AND TRIM(P.PRD_FOTO) <> '') OR P.PRD_IMAGEM IS NOT NULL THEN 1 ELSE 0 END) AS TEM_FOTO
FROM TB_PRODUTO P
LEFT JOIN TB_PRODUTO_ESTOQUE E ON (E.PRDE_PRODUTO = P.PRD_ID AND E.PRDE_EMPRESA = 1)
WHERE P.PRD_ID = ${id}
`;
    const rows = await query(sql);
    if (!rows || rows.length === 0) return null;
    const p = rows[0];
    const precoVenda = parseFloat(p.PRD_PRECO_VENDA) || 0;
    const precoProm = parseFloat(p.PRD_VALOR_PROM) || 0;
    const emPromocao = isPromoVigente(precoProm, p.PRD_DT_INI_PROM, p.PRD_DT_FIM_PROM);
    const descontoPercentual = emPromocao && precoVenda > 0 ? Math.round(((precoVenda - precoProm) / precoVenda) * 100) : 0;

    return {
        id: parseInt(p.PRD_ID, 10),
        codigo: p.PRD_CODIGO || '',
        descricao: p.PRD_DESCRICAO || '',
        status: p.PRD_STATUS || 'A',
        unidade: p.PRD_UN_VENDA || 'UN',
        referencia: p.PRD_REFERENCIA || '',
        tipoProduto: p.PRD_TIPO_PRODUTO || 'N',
        fotoPath: p.PRD_FOTO || '',
        precoVenda,
        precoCompra: parseFloat(p.PRD_PRECO_COMPRA) || 0,
        precoMinimo: parseFloat(p.PRD_PRECO_MINIMO) || 0,
        precoPromocao: precoProm,
        dtInicioProm: p.PRD_DT_INI_PROM || null,
        dtFimProm: p.PRD_DT_FIM_PROM || null,
        tipoValorProm: p.PRD_TIPO_VALOR_PROM || 'V',
        emPromocao,
        descontoPercentual,
        estoque: parseFloat(p.ESTOQUE) || 0,
        estoqueNf: parseFloat(p.ESTOQUE_NF) || 0,
        estoqueMinimo: parseFloat(p.PRD_ESTOQUE_MINIMO_NF) || 0,
        observacao: hexToWin1252(p.PRD_OBSERVACAO),
        temFoto: p.TEM_FOTO === '1',
        ultimaAlteracao: p.PRD_ULTIMA_ALTERACAO
    };
}

// --- Image Operations ---
// Origem da foto: arquivo em PRD_FOTO (se existir no disco) ou o BLOB PRD_IMAGEM.
// Cache valido enquanto PRD_ULTIMA_ALTERACAO do produto nao mudar (alteracoes feitas no ERP invalidam).
const metaPath = (prdId) => path.join(cacheDir, `prd_${prdId}.meta`);
function readCacheMeta(prdId) {
    try { return fs.readFileSync(metaPath(prdId), 'utf8').trim(); } catch (e) { return null; }
}
function writeCacheMeta(prdId, stamp) {
    try { if (stamp) fs.writeFileSync(metaPath(prdId), stamp, 'utf8'); } catch (e) {}
}
async function getProductStamp(prdId) {
    try {
        const rows = await query('SELECT PRD_ULTIMA_ALTERACAO FROM TB_PRODUTO WHERE PRD_ID = ?', [parseInt(prdId, 10)]);
        return rows[0] ? (rows[0].PRD_ULTIMA_ALTERACAO || '') : null;
    } catch (e) {
        return null;
    }
}

// Miniaturas (sharp e opcional: sem ele, serve o original)
let sharpLib = null;
try { sharpLib = require('sharp'); } catch (e) { sharpLib = null; }
const THUMB_WIDTHS = [120, 240, 400, 800, 1200];

function pickThumbWidth(w) {
    const n = parseInt(w, 10);
    if (!n || n <= 0) return 0;
    return THUMB_WIDTHS.find((x) => x >= n) || THUMB_WIDTHS[THUMB_WIDTHS.length - 1];
}
function removeThumbs(prdId) {
    try {
        const prefix = `prd_${prdId}_w`;
        for (const name of fs.readdirSync(cacheDir)) {
            if (name.startsWith(prefix)) { try { fs.unlinkSync(path.join(cacheDir, name)); } catch (e) {} }
        }
    } catch (e) { /* ignora */ }
}

async function getOriginalImage(prdId, knownStamp) {
    const cachedJpg = path.join(cacheDir, `prd_${prdId}.jpg`);
    const cachedPng = path.join(cacheDir, `prd_${prdId}.png`);
    const cached = fs.existsSync(cachedJpg)
        ? { path: cachedJpg, type: 'image/jpeg' }
        : fs.existsSync(cachedPng) ? { path: cachedPng, type: 'image/png' } : null;

    if (cached) {
        const saved = readCacheMeta(prdId);
        if (!knownStamp || saved === knownStamp) return cached;
        if (saved === null) {
            writeCacheMeta(prdId, knownStamp); // cache antigo sem meta: adota o carimbo atual
            return cached;
        }
        // Produto alterado depois do cache: descarta (original e miniaturas) e busca de novo
        try { fs.unlinkSync(cached.path); } catch (e) {}
        removeThumbs(prdId);
    }

    const freshStamp = knownStamp || await getProductStamp(prdId);
    const rows = await rawQuery('SELECT PRD_FOTO, PRD_IMAGEM FROM TB_PRODUTO WHERE PRD_ID = ?', [prdId], { blobs: true });
    if (!rows.length) return null;
    const row = rows[0];

    // 1. PRD_FOTO aponta para um arquivo fisico
    const fotoPath = row.PRD_FOTO ? String(row.PRD_FOTO).trim() : '';
    if (fotoPath) {
        const ext = path.extname(fotoPath).toLowerCase();
        try {
            const st = fs.statSync(fotoPath);
            if (['.jpg', '.jpeg', '.png'].includes(ext) && st.isFile() && st.size <= 25 * 1024 * 1024) {
                return { path: fotoPath, type: ext === '.png' ? 'image/png' : 'image/jpeg' };
            }
        } catch (e) { /* arquivo inexistente: segue para o BLOB */ }
    }

    // 2. BLOB PRD_IMAGEM
    const buf = Buffer.isBuffer(row.PRD_IMAGEM) ? row.PRD_IMAGEM : null;
    if (!buf || buf.length < 20) return null;
    const isPng = buf[0] === 0x89 && buf[1] === 0x50;
    const filePath = isPng ? cachedPng : cachedJpg;
    fs.writeFileSync(filePath, buf);
    writeCacheMeta(prdId, freshStamp);
    return { path: filePath, type: isPng ? 'image/png' : 'image/jpeg', buffer: buf };
}

// width: largura desejada em px (0 = original). Miniaturas ficam em cache/prd_<id>_w<largura>.jpg
async function getProductImage(prdId, knownStamp = '', width = 0) {
    prdId = parseInt(prdId, 10);
    const orig = await getOriginalImage(prdId, knownStamp);
    if (!orig) return null;

    const w = pickThumbWidth(width);
    if (!w || !sharpLib) return orig;

    const thumbPath = path.join(cacheDir, `prd_${prdId}_w${w}.jpg`);
    try {
        let fresh = false;
        if (fs.existsSync(thumbPath)) {
            fresh = fs.statSync(thumbPath).mtimeMs >= fs.statSync(orig.path).mtimeMs;
        }
        if (!fresh) {
            await sharpLib(orig.buffer || orig.path)
                .rotate()
                .resize({ width: w, withoutEnlargement: true })
                .flatten({ background: '#ffffff' })
                .jpeg({ quality: 80, mozjpeg: true })
                .toFile(thumbPath);
        }
        return { path: thumbPath, type: 'image/jpeg' };
    } catch (err) {
        console.warn(`Miniatura de ${prdId} falhou (${err.message}); servindo original.`);
        return orig;
    }
}

async function saveProductImage(prdId, buffer) {
    prdId = parseInt(prdId, 10);
    if (!prdId) throw httpError(400, 'ID do produto inválido');
    const isPng = buffer.length > 3 && buffer[0] === 0x89 && buffer[1] === 0x50;
    const isJpg = buffer.length > 3 && buffer[0] === 0xFF && buffer[1] === 0xD8;
    if (!isPng && !isJpg) throw httpError(400, 'Formato de imagem não suportado (use JPG ou PNG)');

    // Grava com a extensao correta e remove o cache da outra extensao e as miniaturas
    const ext = isPng ? 'png' : 'jpg';
    const cachedFile = path.join(cacheDir, `prd_${prdId}.${ext}`);
    const staleFile = path.join(cacheDir, `prd_${prdId}.${isPng ? 'jpg' : 'png'}`);
    try { fs.unlinkSync(staleFile); } catch (e) {}
    fs.writeFileSync(cachedFile, buffer);
    try { fs.unlinkSync(metaPath(prdId)); } catch (e) {}
    removeThumbs(prdId);

    // Buffer como parametro: o driver envia o BLOB direto (sem literal hexadecimal gigante)
    await runStatements([{
        sql: 'UPDATE TB_PRODUTO SET PRD_IMAGEM = ?, PRD_FOTO = ?, PRD_ULTIMA_ALTERACAO = CURRENT_TIMESTAMP WHERE PRD_ID = ?',
        params: [buffer, cachedFile.substring(0, 500), prdId]
    }]);
    await logAudit({
        empresa: 1,
        tabela: 'TB_PRODUTO',
        idRegistro: String(prdId),
        acao: 'A',
        descRegistro: `Atualização de Foto do Produto ${prdId}`,
        changes: [{ campo: 'PRD_FOTO', campoDesc: 'Foto do Produto', antigo: '[Anterior]', novo: '[Nova Imagem]' }]
    });
}

// --- Updates with ERP Audit Trail ---
async function updateProductStatus(prdId, newStatus) {
    if (newStatus !== 'A' && newStatus !== 'I') throw httpError(400, "Status deve ser 'A' ou 'I'");
    const current = await getProductById(prdId);
    if (!current) throw httpError(404, 'Produto não encontrado');
    if (current.status === newStatus) return current;

    const sql = `
UPDATE TB_PRODUTO 
SET PRD_STATUS = '${newStatus}',
    PRD_ULTIMA_ALTERACAO = CURRENT_TIMESTAMP
WHERE PRD_ID = ${prdId};
`;
    await execute(sql);

    await logAudit({
        empresa: 1,
        tabela: 'TB_PRODUTO',
        idRegistro: String(prdId),
        acao: 'A',
        descRegistro: current.descricao,
        changes: [{
            campo: 'PRD_STATUS',
            campoDesc: 'Status do Produto',
            antigo: current.status === 'A' ? 'Ativo' : 'Inativo',
            novo: newStatus === 'A' ? 'Ativo' : 'Inativo'
        }]
    });

    return getProductById(prdId);
}

async function updateProductPrice(prdId, newPrice, newMinPrice = null) {
    const current = await getProductById(prdId);
    if (!current) throw httpError(404, 'Produto não encontrado');

    const pVenda = parseFloat(newPrice);
    if (isNaN(pVenda) || pVenda < 0) throw httpError(400, 'Preço inválido');

    const hasMin = newMinPrice !== null && newMinPrice !== undefined && newMinPrice !== '';
    const pMin = hasMin ? parseFloat(newMinPrice) : current.precoMinimo;
    if (isNaN(pMin) || pMin < 0) throw httpError(400, 'Preço mínimo inválido');

    const sql = `
UPDATE TB_PRODUTO 
SET PRD_PRECO_VENDA = ${pVenda.toFixed(4)},
    PRD_PRECO_MINIMO = ${pMin.toFixed(4)},
    PRD_ULTIMA_ALTERACAO = CURRENT_TIMESTAMP
WHERE PRD_ID = ${prdId};

UPDATE TB_PRODUTO_PRECO
SET PRDP_PRECO_VENDA = ${pVenda.toFixed(4)},
    PRDP_PRECO_MINIMO = ${pMin.toFixed(4)}
WHERE PRDP_PRODUTO = ${prdId} AND PRDP_EMPRESA = 1;
`;
    await execute(sql);

    const changes = [
        {
            campo: 'PRD_PRECO_VENDA',
            campoDesc: 'Preço de Venda',
            antigo: current.precoVenda.toFixed(2),
            novo: pVenda.toFixed(2)
        }
    ];
    if (hasMin) {
        changes.push({
            campo: 'PRD_PRECO_MINIMO',
            campoDesc: 'Preço Mínimo',
            antigo: current.precoMinimo.toFixed(2),
            novo: pMin.toFixed(2)
        });
    }

    await logAudit({
        empresa: 1,
        tabela: 'TB_PRODUTO',
        idRegistro: String(prdId),
        acao: 'A',
        descRegistro: current.descricao,
        changes
    });

    return getProductById(prdId);
}

async function updateProductPromotion(prdId, { ativo, valorPromocional, dtInicio, dtFim, tipoValor = 'V' }) {
    const current = await getProductById(prdId);
    if (!current) throw httpError(404, 'Produto não encontrado');

    let sql = '';
    const changes = [];

    if (!ativo) {
        sql = `
UPDATE TB_PRODUTO
SET PRD_VALOR_PROM = NULL,
    PRD_DT_INI_PROM = NULL,
    PRD_DT_FIM_PROM = NULL,
    PRD_ULTIMA_ALTERACAO = CURRENT_TIMESTAMP
WHERE PRD_ID = ${prdId};
`;
        changes.push({
            campo: 'PRD_VALOR_PROM',
            campoDesc: 'Promoção Cancelada',
            antigo: current.precoPromocao ? current.precoPromocao.toFixed(2) : '0.00',
            novo: 'Sem Promoção'
        });
    } else {
        const vProm = parseFloat(valorPromocional);
        if (isNaN(vProm) || vProm <= 0) throw httpError(400, 'Valor promocional inválido');

        dtInicio = sqlDate(dtInicio);
        dtFim = sqlDate(dtFim);
        tipoValor = 'V'; // a promocao e sempre gravada em valor (R$)
        const dIniStr = dtInicio ? `'${dtInicio}'` : 'CURRENT_DATE';
        const dFimStr = dtFim ? `'${dtFim}'` : 'NULL';

        sql = `
UPDATE TB_PRODUTO
SET PRD_VALOR_PROM = ${vProm.toFixed(4)},
    PRD_DT_INI_PROM = ${dIniStr},
    PRD_DT_FIM_PROM = ${dFimStr},
    PRD_TIPO_VALOR_PROM = '${tipoValor}',
    PRD_ULTIMA_ALTERACAO = CURRENT_TIMESTAMP
WHERE PRD_ID = ${prdId};
`;
        changes.push({
            campo: 'PRD_VALOR_PROM',
            campoDesc: 'Preço Promocional',
            antigo: current.precoPromocao ? current.precoPromocao.toFixed(2) : '0.00',
            novo: vProm.toFixed(2)
        });
        if (dtInicio) {
            changes.push({ campo: 'PRD_DT_INI_PROM', campoDesc: 'Início Promoção', antigo: current.dtInicioProm || '', novo: dtInicio });
        }
        if (dtFim) {
            changes.push({ campo: 'PRD_DT_FIM_PROM', campoDesc: 'Fim Promoção', antigo: current.dtFimProm || '', novo: dtFim });
        }
    }

    await execute(sql);
    await logAudit({
        empresa: 1,
        tabela: 'TB_PRODUTO',
        idRegistro: String(prdId),
        acao: 'A',
        descRegistro: current.descricao,
        changes
    });

    return getProductById(prdId);
}

// Estoque atual lido DENTRO da trava (mesma linha/local que buildStockSql atualiza)
async function estoqueAtual(prdId) {
    const r = await query(`SELECT FIRST 1 PRDE_ESTOQUE FROM TB_PRODUTO_ESTOQUE WHERE PRDE_PRODUTO = ${prdId} AND PRDE_EMPRESA = 1 ORDER BY PRDE_LOCAL`);
    return r.length ? (parseFloat(r[0].PRDE_ESTOQUE) || 0) : 0;
}

// O ID do movimento e MAX+1: se o ERP gravar no mesmo instante a chave colide; tenta de novo (recalcula o MAX)
const PK_ERR_RE = /violation of (PRIMARY|UNIQUE)|PRIMARY or UNIQUE|unique key|duplicate/i;
async function executeComRetentativa(buildSql, tentativas = 3) {
    let ultimo;
    for (let i = 0; i < tentativas; i++) {
        try { return await execute(await buildSql()); } catch (e) {
            ultimo = e;
            if (!PK_ERR_RE.test(String(e && e.message))) throw e;
        }
    }
    throw ultimo;
}

// Monta o SQL de ajuste de estoque + movimento. Deve rodar dentro de withLock().
// Atualiza apenas a linha de estoque existente (local detectado), nunca todas as linhas da empresa.
async function buildStockSql(prdId, newStock, diff, motivo) {
    const existRows = await query(`SELECT FIRST 1 PRDE_LOCAL FROM TB_PRODUTO_ESTOQUE WHERE PRDE_PRODUTO = ${prdId} AND PRDE_EMPRESA = 1 ORDER BY PRDE_LOCAL`);
    let sql = '';
    let localMov = 1; // o movimento vai para o MESMO local do saldo atualizado
    if (existRows.length > 0) {
        const local = parseInt(existRows[0].PRDE_LOCAL, 10);
        if (!isNaN(local)) localMov = local;
        const localCond = isNaN(local) ? 'PRDE_LOCAL IS NULL' : `PRDE_LOCAL = ${local}`;
        sql += `
UPDATE TB_PRODUTO_ESTOQUE
SET PRDE_ESTOQUE = ${newStock.toFixed(4)},
    PRDE_ULTIMA_ALTERACAO = CURRENT_TIMESTAMP
WHERE PRDE_PRODUTO = ${prdId} AND PRDE_EMPRESA = 1 AND ${localCond};
`;
    } else {
        sql += `
INSERT INTO TB_PRODUTO_ESTOQUE (PRDE_EMPRESA, PRDE_PRODUTO, PRDE_LOCAL, PRDE_ESTOQUE, PRDE_ESTOQUE_NF, PRDE_ULTIMA_ALTERACAO)
VALUES (1, ${prdId}, 1, ${newStock.toFixed(4)}, 0, CURRENT_TIMESTAMP);
`;
    }

    if (Math.abs(diff) > 0.0001) {
        const tipo = diff >= 0 ? 'ENT' : 'SAI';
        const safeMotivo = sqlStr(motivo || 'Ajuste de estoque via Upweb', 150);
        // O ERP numera os movimentos pelo gerador GEN_TB_PRODUTO_MOVIMENTO (e grava PRDM_SEQUENCIA = PRDM_ID).
        // Usar o MESMO gerador evita que o proximo movimento do ERP (venda/compra) colida com o nosso id.
        let movId = null;
        try {
            const g = await query('SELECT GEN_ID(GEN_TB_PRODUTO_MOVIMENTO, 1) AS ID FROM RDB$DATABASE');
            const v = parseInt(g[0].ID, 10);
            if (Number.isInteger(v) && v > 0) movId = v;
        } catch (e) { /* sem gerador: usa MAX+1 abaixo */ }
        const idExpr = movId !== null ? String(movId) : '(SELECT COALESCE(MAX(PRDM_ID), 0) + 1 FROM TB_PRODUTO_MOVIMENTO)';
        const seqExpr = movId !== null ? String(movId) : `(SELECT COALESCE(MAX(PRDM_SEQUENCIA), 0) + 1 FROM TB_PRODUTO_MOVIMENTO WHERE PRDM_PRODUTO = ${prdId})`;
        sql += `
INSERT INTO TB_PRODUTO_MOVIMENTO (
    PRDM_ID, PRDM_EMPRESA, PRDM_PRODUTO, PRDM_SEQUENCIA,
    PRDM_TIPO, PRDM_QUANTIDADE, PRDM_ORIGEM_MOVIMENTO,
    PRDM_ORIGEM_NUMERO, PRDM_HISTORICO, PRDM_DT_MOVIMENTO,
    PRDM_DT_LANCAMENTO, PRDM_LOCAL, PRDM_EMPRESA_ORIGEM, PRDM_USUARIO, PRDM_CUSTO_UN, PRDM_CUSTO
) VALUES (
    ${idExpr}, 1, ${prdId},
    ${seqExpr},
    '${tipo}', ${Math.abs(diff).toFixed(4)}, 'Upweb',
    ${prdId}, '${safeMotivo}', CURRENT_DATE,
    CURRENT_TIMESTAMP, ${localMov}, 1, 1, 0, 0
);
`;
    }
    return sql;
}

// --- Stock Update with TB_PRODUTO_MOVIMENTO & Audit (Origem: Upweb) ---
async function updateProductStock(prdId, newStock, motivo = 'Ajuste de estoque via Upweb') {
    const current = await getProductById(prdId);
    if (!current) throw httpError(404, 'Produto não encontrado');

    const pStock = parseFloat(newStock);
    if (isNaN(pStock)) throw httpError(400, 'Estoque inválido');

    let oldStock = current.estoque;
    await withLock(async () => {
        // le o estoque dentro da trava: edicoes simultaneas nao geram movimento com diferenca errada
        oldStock = await estoqueAtual(prdId);
        const diff = pStock - oldStock;
        await executeComRetentativa(() => buildStockSql(prdId, pStock, diff, motivo));
    });

    // Audit with Upweb
    await logAudit({
        empresa: 1,
        tabela: 'TB_PRODUTO_ESTOQUE',
        idRegistro: String(prdId),
        acao: 'A',
        descRegistro: `[Upweb] Ajuste de Estoque: ${current.descricao}`,
        usuario: 1,
        changes: [{
            campo: 'PRDE_ESTOQUE',
            campoDesc: 'Estoque do Produto',
            antigo: oldStock.toFixed(2),
            novo: pStock.toFixed(2)
        }]
    });

    return getProductById(prdId);
}

// --- Quick Edit Product (Preço, Promoção, Estoque, Status) with Origin: Upweb ---
async function quickEditProduct(prdId, { precoVenda, precoMinimo, emPromocao, precoPromocao, dtInicioProm, dtFimProm, estoque, status }) {
    const current = await getProductById(prdId);
    if (!current) throw httpError(404, 'Produto não encontrado');

    const changes = [];
    const prodUpdates = [];

    // 1. Status
    if (status !== undefined && status !== 'A' && status !== 'I') {
        throw httpError(400, "Status deve ser 'A' ou 'I'");
    }
    if (status !== undefined && status !== current.status) {
        prodUpdates.push(`PRD_STATUS = '${status}'`);
        changes.push({
            campo: 'PRD_STATUS',
            campoDesc: 'Status',
            antigo: current.status === 'A' ? 'Ativo' : 'Inativo',
            novo: status === 'A' ? 'Ativo' : 'Inativo'
        });
    }

    // 2. Preço de venda & mínimo
    if (precoVenda !== undefined) {
        const pV = parseFloat(precoVenda);
        if (!isNaN(pV) && pV < 0) throw httpError(400, 'Preço de venda inválido');
        if (!isNaN(pV) && Math.abs(pV - current.precoVenda) > 0.001) {
            prodUpdates.push(`PRD_PRECO_VENDA = ${pV.toFixed(4)}`);
            changes.push({ campo: 'PRD_PRECO_VENDA', campoDesc: 'Preço Venda', antigo: current.precoVenda.toFixed(2), novo: pV.toFixed(2) });
        }
    }
    if (precoMinimo !== undefined) {
        const pM = parseFloat(precoMinimo);
        if (!isNaN(pM) && pM < 0) throw httpError(400, 'Preço mínimo inválido');
        if (!isNaN(pM) && Math.abs(pM - current.precoMinimo) > 0.001) {
            prodUpdates.push(`PRD_PRECO_MINIMO = ${pM.toFixed(4)}`);
            changes.push({ campo: 'PRD_PRECO_MINIMO', campoDesc: 'Preço Mínimo', antigo: current.precoMinimo.toFixed(2), novo: pM.toFixed(2) });
        }
    }

    // 3. Promoção
    if (emPromocao !== undefined) {
        if (!emPromocao) {
            if (current.precoPromocao > 0) { // inclui promocao ja expirada
                prodUpdates.push(`PRD_VALOR_PROM = NULL, PRD_DT_INI_PROM = NULL, PRD_DT_FIM_PROM = NULL`);
                changes.push({ campo: 'PRD_VALOR_PROM', campoDesc: 'Promoção Desativada', antigo: current.precoPromocao.toFixed(2), novo: 'Desativada' });
            }
        } else if (precoPromocao !== undefined) {
            const pP = parseFloat(precoPromocao);
            if (!isNaN(pP) && pP > 0) {
                const pVfinal = (precoVenda !== undefined && isFinite(parseFloat(precoVenda))) ? parseFloat(precoVenda) : current.precoVenda;
                if (pVfinal > 0 && pP >= pVfinal) throw httpError(400, 'O preço promocional deve ser menor que o preço de venda');
                prodUpdates.push(`PRD_VALOR_PROM = ${pP.toFixed(4)}`);
                changes.push({ campo: 'PRD_VALOR_PROM', campoDesc: 'Preço Promocional', antigo: current.precoPromocao.toFixed(2), novo: pP.toFixed(2) });
                // Inicio: o informado; senao mantem o ja gravado; senao hoje (sempre grava, nunca fica vazio)
                const dI = sqlDate(dtInicioProm)
                    || (current.dtInicioProm && String(current.dtInicioProm).substring(0, 10)) || hojeStr();
                let dF = sqlDate(dtFimProm);
                // reativar sem informar o fim: nao herda uma data de termino ja vencida (a promocao nasceria expirada)
                if (!dF && current.dtFimProm && String(current.dtFimProm).substring(0, 10) >= hojeStr()) {
                    dF = String(current.dtFimProm).substring(0, 10);
                }
                if (dF && dF < hojeStr()) throw httpError(400, 'A data de término já passou');
                if (dF && dF < dI) throw httpError(400, 'A data de término não pode ser anterior ao início');
                prodUpdates.push(`PRD_DT_INI_PROM = '${dI}'`);
                prodUpdates.push(dF ? `PRD_DT_FIM_PROM = '${dF}'` : 'PRD_DT_FIM_PROM = NULL');
                if (!current.tipoValorProm || current.tipoValorProm !== 'V') prodUpdates.push("PRD_TIPO_VALOR_PROM = 'V'");
                changes.push({ campo: 'PRD_DT_INI_PROM', campoDesc: 'Início Promoção', antigo: current.dtInicioProm || '', novo: dI });
                changes.push({ campo: 'PRD_DT_FIM_PROM', campoDesc: 'Fim Promoção', antigo: current.dtFimProm || '', novo: dF || 'Indeterminado' });
            }
        }
    }

    let sql = '';
    if (prodUpdates.length > 0) {
        prodUpdates.push('PRD_ULTIMA_ALTERACAO = CURRENT_TIMESTAMP');
        sql += `
UPDATE TB_PRODUTO 
SET ${prodUpdates.join(', ')}
WHERE PRD_ID = ${prdId};
`;
        if (precoVenda !== undefined || precoMinimo !== undefined) {
            const pV = isFinite(parseFloat(precoVenda)) ? parseFloat(precoVenda) : current.precoVenda;
            const pM = isFinite(parseFloat(precoMinimo)) ? parseFloat(precoMinimo) : current.precoMinimo;
            sql += `
UPDATE TB_PRODUTO_PRECO
SET PRDP_PRECO_VENDA = ${pV.toFixed(4)},
    PRDP_PRECO_MINIMO = ${pM.toFixed(4)}
WHERE PRDP_PRODUTO = ${prdId} AND PRDP_EMPRESA = 1;
`;
        }
    }

    // 4. Estoque com TB_PRODUTO_MOVIMENTO (Origem Upweb)
    let stockChange = null;
    if (estoque !== undefined) {
        const nEstoque = parseFloat(estoque);
        if (!isNaN(nEstoque) && Math.abs(nEstoque - current.estoque) > 0.001) {
            stockChange = { nEstoque, diff: nEstoque - current.estoque };
            changes.push({ campo: 'PRDE_ESTOQUE', campoDesc: 'Estoque do Produto', antigo: current.estoque.toFixed(2), novo: nEstoque.toFixed(2) });
        }
    }

    await withLock(async () => {
        if (stockChange) {
            const atual = await estoqueAtual(prdId);
            const base = sql;
            await executeComRetentativa(async () => base + await buildStockSql(prdId, stockChange.nEstoque, stockChange.nEstoque - atual, 'Ajuste de estoque via Upweb'));
        } else if (sql.trim().length > 0) {
            await execute(sql);
        }
    });

    if (changes.length > 0) {
        await logAudit({
            empresa: 1,
            tabela: 'TB_PRODUTO',
            idRegistro: String(prdId),
            acao: 'A',
            descRegistro: `[Upweb] Alteração: ${current.descricao}`,
            usuario: 1,
            changes
        });
    }

    return getProductById(prdId);
}

async function updateProductFields(prdId, fields) {
    const current = await getProductById(prdId);
    if (!current) throw httpError(404, 'Produto não encontrado');
    fields = fields || {};

    const updates = [];
    const changes = [];
    const str = (v) => (v === null || v === undefined ? '' : String(v).trim());
    const limite = (nome, valor, max) => {
        if (valor.length > max) throw httpError(400, `${nome} excede ${max} caracteres`);
    };

    // Limites conforme colunas de TB_PRODUTO: DESCRICAO(100), UN_VENDA(6), REFERENCIA(100), FOTO(500)
    if (fields.descricao !== undefined && str(fields.descricao) !== '') {
        const desc = str(fields.descricao);
        limite('Descrição', desc, 100);
        if (desc !== current.descricao) {
            updates.push(`PRD_DESCRICAO = '${sqlStr(desc, 100)}'`);
            changes.push({ campo: 'PRD_DESCRICAO', campoDesc: 'Descrição', antigo: current.descricao, novo: desc });
        }
    }
    if (fields.unidade !== undefined && str(fields.unidade) !== '') {
        const un = str(fields.unidade).toUpperCase();
        limite('Unidade', un, 6);
        if (un !== current.unidade) {
            updates.push(`PRD_UN_VENDA = '${sqlStr(un, 6)}'`);
            changes.push({ campo: 'PRD_UN_VENDA', campoDesc: 'Unidade', antigo: current.unidade, novo: un });
        }
    }
    if (fields.referencia !== undefined) {
        const ref = str(fields.referencia);
        limite('Referência', ref, 100);
        if (ref !== current.referencia) {
            updates.push(`PRD_REFERENCIA = '${sqlStr(ref, 100)}'`);
            changes.push({ campo: 'PRD_REFERENCIA', campoDesc: 'Referência', antigo: current.referencia, novo: ref });
        }
    }
    if (fields.observacao !== undefined) {
        const obs = str(fields.observacao);
        // So grava se mudou (a UI reenvia o texto lido; evita regravar/truncar o blob sem necessidade)
        if (obs !== str(current.observacao)) {
            limite('Observação', obs, 4000);
            // PRD_OBSERVACAO e BLOB subtype 0: um literal de texto troca acentos por '.', entao vai em hex (win1252)
            updates.push(obs === '' ? 'PRD_OBSERVACAO = NULL' : `PRD_OBSERVACAO = x'${encodeWin1252(obs).toString('hex')}'`);
            changes.push({ campo: 'PRD_OBSERVACAO', campoDesc: 'Observação', antigo: current.observacao, novo: obs });
        }
    }
    if (fields.fotoPath !== undefined) {
        const fPath = str(fields.fotoPath);
        limite('Caminho da foto', fPath, 500);
        if (fPath !== current.fotoPath) {
            updates.push(`PRD_FOTO = '${sqlStr(fPath, 500)}'`);
            changes.push({ campo: 'PRD_FOTO', campoDesc: 'Caminho da Foto', antigo: current.fotoPath, novo: fPath });
        }
    }

    if (updates.length === 0) return current;
    updates.push('PRD_ULTIMA_ALTERACAO = CURRENT_TIMESTAMP');

    const sql = `
UPDATE TB_PRODUTO
SET ${updates.join(', ')}
WHERE PRD_ID = ${prdId};
`;
    await execute(sql);
    await logAudit({
        empresa: 1,
        tabela: 'TB_PRODUTO',
        idRegistro: String(prdId),
        acao: 'A',
        descRegistro: str(fields.descricao) || current.descricao,
        changes
    });

    return getProductById(prdId);
}

// --- Sales History ---
async function getProductSalesHistory(prdId, limit = 20) {
    const sql = `
SELECT FIRST ${limit}
    I.PEVI_PEDIDO_VENDA,
    I.PEVI_QUANTIDADE,
    I.PEVI_VALOR_UNITARIO,
    I.PEVI_VALOR_TOTAL,
    I.PEVI_DT_LANCAMENTO,
    I.PEVI_VALOR_DESCONTO,
    I.PEVI_PROMOCAO
FROM TB_PEDIDO_VENDA_ITEM I
WHERE I.PEVI_PRODUTO = ${prdId}
ORDER BY I.PEVI_DT_LANCAMENTO DESC
`;
    const rows = await query(sql);
    return rows.map(r => ({
        pedido: parseInt(r.PEVI_PEDIDO_VENDA, 10),
        quantidade: parseFloat(r.PEVI_QUANTIDADE) || 0,
        valorUnitario: parseFloat(r.PEVI_VALOR_UNITARIO) || 0,
        valorTotal: parseFloat(r.PEVI_VALOR_TOTAL) || 0,
        dataLancamento: r.PEVI_DT_LANCAMENTO || '',
        desconto: parseFloat(r.PEVI_VALOR_DESCONTO) || 0,
        foiPromocao: r.PEVI_PROMOCAO ? true : false
    }));
}

// --- Audit History ---
async function getAuditHistory(limit = 30) {
    const sql = `
SELECT FIRST ${limit}
    A.AUD_ID_REGISTRO,
    A.AUD_SEQUENCIA,
    A.AUD_ACAO,
    A.AUD_DT_LANCAMENTO,
    A.AUD_DESC_REGISTRO,
    I.AUDI_CAMPO,
    I.AUDI_CAMPO_DESC,
    I.AUDI_VALOR_ANTIGO,
    I.AUDI_VALOR_NOVO
FROM TB_AUDITORIA A
LEFT JOIN TB_AUDITORIA_ITEM I ON (
    I.AUDI_EMPRESA = A.AUD_EMPRESA AND 
    I.AUDI_TABELA = A.AUD_TABELA AND 
    I.AUDI_ID_REGISTRO = A.AUD_ID_REGISTRO AND 
    I.AUDI_AUDITORIA = A.AUD_SEQUENCIA
)
WHERE A.AUD_TABELA = 'TB_PRODUTO'
ORDER BY A.AUD_SEQUENCIA DESC
`;
    const rows = await query(sql);
    return rows.map(r => ({
        idRegistro: r.AUD_ID_REGISTRO,
        sequencia: parseInt(r.AUD_SEQUENCIA, 10),
        acao: r.AUD_ACAO,
        data: r.AUD_DT_LANCAMENTO,
        descricao: r.AUD_DESC_REGISTRO || '',
        campo: r.AUDI_CAMPO || '',
        campoDesc: r.AUDI_CAMPO_DESC || '',
        valorAntigo: r.AUDI_VALOR_ANTIGO || '',
        valorNovo: r.AUDI_VALOR_NOVO || ''
    }));
}

// --- Dashboard Stats ---
// Calculated for PRD_TIPO_PRODUTO IN ('N', 'P', 'T')
async function getDashboardStats() {
    const totalRow = await query(`SELECT COUNT(*) AS TOTAL FROM TB_PRODUTO WHERE PRD_TIPO_PRODUTO IN ('N', 'P', 'T')`);
    const ativosRow = await query(`SELECT COUNT(*) AS ATIVOS FROM TB_PRODUTO WHERE PRD_STATUS IN ('A', 'P') AND PRD_TIPO_PRODUTO IN ('N', 'P', 'T')`);
    const inativosRow = await query(`SELECT COUNT(*) AS INATIVOS FROM TB_PRODUTO WHERE PRD_STATUS = 'I' AND PRD_TIPO_PRODUTO IN ('N', 'P', 'T')`);
    const promoRow = await query(`SELECT COUNT(*) AS PROMOS FROM TB_PRODUTO WHERE PRD_VALOR_PROM IS NOT NULL AND PRD_VALOR_PROM > 0 AND PRD_TIPO_PRODUTO IN ('N', 'P', 'T') AND (PRD_DT_INI_PROM IS NULL OR PRD_DT_INI_PROM <= CURRENT_DATE) AND (PRD_DT_FIM_PROM IS NULL OR PRD_DT_FIM_PROM >= CURRENT_DATE)`);
    const estoqueBaixoRow = await query(`
SELECT COUNT(*) AS BAIXO 
FROM TB_PRODUTO P 
LEFT JOIN TB_PRODUTO_ESTOQUE E ON (E.PRDE_PRODUTO = P.PRD_ID AND E.PRDE_EMPRESA = 1)
WHERE P.PRD_STATUS IN ('A', 'P') AND P.PRD_TIPO_PRODUTO IN ('N', 'P', 'T') AND (COALESCE(E.PRDE_ESTOQUE, 0) <= 5)
`);

    return {
        totalProdutos: parseInt(totalRow[0]?.TOTAL || 0, 10),
        ativos: parseInt(ativosRow[0]?.ATIVOS || 0, 10),
        inativos: parseInt(inativosRow[0]?.INATIVOS || 0, 10),
        emPromocao: parseInt(promoRow[0]?.PROMOS || 0, 10),
        estoqueBaixo: parseInt(estoqueBaixoRow[0]?.BAIXO || 0, 10),
        databaseConnected: true,
        databaseFile: path.basename(String(fbOptions.database || '').replace(/\\/g, '/')) || 'DADOS.FDB',
        firebirdVersion: `Firebird (${fbOptions.host}:${fbOptions.port})`
    };
}

// --- TV Promotion Display Queries ---
async function getTvPromotions() {
    const sql = `
SELECT 
    P.PRD_ID,
    P.PRD_CODIGO,
    P.PRD_DESCRICAO,
    P.PRD_STATUS,
    P.PRD_UN_VENDA,
    P.PRD_REFERENCIA,
    P.PRD_PRECO_VENDA,
    P.PRD_VALOR_PROM,
    P.PRD_DT_INI_PROM,
    P.PRD_DT_FIM_PROM,
    P.PRD_FOTO,
    P.PRD_ULTIMA_ALTERACAO,
    COALESCE(E.PRDE_ESTOQUE, 0) AS ESTOQUE,
    (CASE WHEN (P.PRD_FOTO IS NOT NULL AND TRIM(P.PRD_FOTO) <> '') OR P.PRD_IMAGEM IS NOT NULL THEN 1 ELSE 0 END) AS TEM_FOTO
FROM TB_PRODUTO P
LEFT JOIN TB_PRODUTO_ESTOQUE E ON (E.PRDE_PRODUTO = P.PRD_ID AND E.PRDE_EMPRESA = 1)
WHERE P.PRD_STATUS IN ('A', 'P') 
  AND P.PRD_TIPO_PRODUTO IN ('N', 'P', 'T')
  AND P.PRD_VALOR_PROM IS NOT NULL 
  AND P.PRD_VALOR_PROM > 0
  AND P.PRD_PRECO_VENDA > 0
  AND (P.PRD_DT_INI_PROM IS NULL OR P.PRD_DT_INI_PROM <= CURRENT_DATE)
  AND (P.PRD_DT_FIM_PROM IS NULL OR P.PRD_DT_FIM_PROM >= CURRENT_DATE)
ORDER BY 
    (CASE WHEN (P.PRD_FOTO IS NOT NULL AND TRIM(P.PRD_FOTO) <> '') OR P.PRD_IMAGEM IS NOT NULL THEN 0 ELSE 1 END),
    ((P.PRD_PRECO_VENDA - P.PRD_VALOR_PROM) / P.PRD_PRECO_VENDA) DESC,
    P.PRD_ID DESC
`;

    const items = await query(sql);

    return items.map(p => {
        const precoVenda = parseFloat(p.PRD_PRECO_VENDA) || 0;
        const precoProm = parseFloat(p.PRD_VALOR_PROM) || 0;
        const descontoPercentual = precoVenda > 0 ? Math.round(((precoVenda - precoProm) / precoVenda) * 100) : 0;
        const economiaReais = Math.max(0, precoVenda - precoProm);

        return {
            id: parseInt(p.PRD_ID, 10),
            codigo: p.PRD_CODIGO || '',
            descricao: p.PRD_DESCRICAO || '',
            unidade: p.PRD_UN_VENDA || 'UN',
            referencia: p.PRD_REFERENCIA || '',
            precoVenda,
            precoPromocao: precoProm,
            descontoPercentual,
            economiaReais,
            dtInicioProm: p.PRD_DT_INI_PROM || null,
            dtFimProm: p.PRD_DT_FIM_PROM || null,
            estoque: parseFloat(p.ESTOQUE) || 0,
            temFoto: p.TEM_FOTO === '1',
            ultimaAlteracao: p.PRD_ULTIMA_ALTERACAO || ''
        };
    });
}

// --- Orders and Password Queue Management ---

async function generateNextDailyPassword() {
    const rows = await query(`
        SELECT PEV_SENHA 
        FROM TB_PEDIDO_VENDA 
        WHERE PEV_DT_EMISSAO = CURRENT_DATE 
          AND PEV_SENHA IS NOT NULL 
          AND TRIM(PEV_SENHA) <> ''
    `);
    let maxNum = 0;
    rows.forEach(r => {
        const val = parseInt(r.PEV_SENHA, 10);
        if (!isNaN(val) && val > maxNum) maxNum = val;
    });
    const next = maxNum + 1;
    return next < 10 ? `0${next}` : String(next);
}

async function getOrders({ filter = 'PREPARO', search = '', limit = 50, todosDias = false }) {
    let whereClauses = ["COALESCE(P.PEV_STATUS, '') <> 'C'"]; // exclude cancelled (NULL-safe)
    // Senhas reiniciam por dia: sem isso, vendas antigas do ERP (sem hora de "pronto") ficam
    // para sempre em "Em Preparo".
    if (!todosDias) whereClauses.push("P.PEV_DT_EMISSAO = CURRENT_DATE");

    if (filter === 'PREPARO') {
        whereClauses.push("P.PEV_DT_HR_PRONTO IS NULL AND P.PEV_DT_HR_ENTREGUE IS NULL");
    } else if (filter === 'PRONTOS') {
        whereClauses.push("P.PEV_DT_HR_PRONTO IS NOT NULL AND P.PEV_DT_HR_ENTREGUE IS NULL");
    } else if (filter === 'ENTREGUES') {
        whereClauses.push("P.PEV_DT_HR_ENTREGUE IS NOT NULL");
    } else if (filter === 'ATIVOS') {
        whereClauses.push("P.PEV_DT_HR_ENTREGUE IS NULL");
    }

    if (search && search.trim() !== '') {
        const term = sqlLike(search.trim());
        // PEV_ID e PEV_SENHA sao numericos: o Firebird os converte em ASCII e comparar com texto acentuado
        // dispara "Malformed string". So entram na busca quando o termo e ASCII.
        const asciiOnly = /^[\x00-\x7F]*$/.test(term);
        const conds = [
            `UPPER(P.PEV_NOME) LIKE '%${term}%' ESCAPE '\\'`,
            `UPPER(P.PEV_COMANDA) LIKE '%${term}%' ESCAPE '\\'`
        ];
        if (asciiOnly) {
            conds.push(`CAST(P.PEV_ID AS VARCHAR(20)) LIKE '%${term}%' ESCAPE '\\'`);
            conds.push(`CAST(P.PEV_SENHA AS VARCHAR(20)) LIKE '%${term}%' ESCAPE '\\'`);
        }
        whereClauses.push(`(${conds.join(' OR ')})`);
    }
    limit = Math.min(500, Math.max(1, parseInt(limit, 10) || 50));

    const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

    const orders = await query(`
        SELECT FIRST ${limit}
            P.PEV_ID,
            P.PEV_DT_EMISSAO,
            P.PEV_DT_LANCAMENTO,
            P.PEV_VALOR_TOTAL,
            P.PEV_STATUS,
            P.PEV_SENHA,
            P.PEV_DT_HR_PRONTO,
            P.PEV_DT_HR_ENTREGUE,
            P.PEV_NOME,
            P.PEV_MESA,
            P.PEV_COMANDA
        FROM TB_PEDIDO_VENDA P
        ${whereSql}
        ORDER BY 
            (CASE WHEN P.PEV_DT_HR_PRONTO IS NOT NULL AND P.PEV_DT_HR_ENTREGUE IS NULL THEN 0 ELSE 1 END),
            P.PEV_ID DESC
    `);

    if (orders.length === 0) return [];

    const orderIds = orders.map(o => o.PEV_ID).join(',');
    const items = await query(`
        SELECT 
            I.PEVI_PEDIDO_VENDA,
            I.PEVI_SEQUENCIA,
            I.PEVI_PRODUTO,
            I.PEVI_DESCRICAO,
            I.PEVI_QUANTIDADE,
            I.PEVI_VALOR_UNITARIO,
            I.PEVI_VALOR_TOTAL
        FROM TB_PEDIDO_VENDA_ITEM I
        WHERE I.PEVI_PEDIDO_VENDA IN (${orderIds})
        ORDER BY I.PEVI_PEDIDO_VENDA DESC, I.PEVI_SEQUENCIA ASC
    `);

    const itemsByOrder = {};
    items.forEach(it => {
        const ordId = it.PEVI_PEDIDO_VENDA;
        if (!itemsByOrder[ordId]) itemsByOrder[ordId] = [];
        itemsByOrder[ordId].push({
            sequencia: it.PEVI_SEQUENCIA,
            produtoId: it.PEVI_PRODUTO,
            descricao: it.PEVI_DESCRICAO,
            quantidade: parseFloat(it.PEVI_QUANTIDADE) || 1,
            valorUnitario: parseFloat(it.PEVI_VALOR_UNITARIO) || 0,
            valorTotal: parseFloat(it.PEVI_VALOR_TOTAL) || 0
        });
    });

    return orders.map(o => {
        const id = parseInt(o.PEV_ID, 10);
        let senha = o.PEV_SENHA && o.PEV_SENHA.trim() !== ''
            ? o.PEV_SENHA.trim()
            : String(id).slice(-3); // fallback to last 3 digits of order ID
        if (/^\d$/.test(senha)) senha = '0' + senha; // PEV_SENHA e inteiro: restaura o zero a esquerda

        let estado = 'PREPARO';
        if (o.PEV_DT_HR_ENTREGUE) {
            estado = 'ENTREGUE';
        } else if (o.PEV_DT_HR_PRONTO) {
            estado = 'PRONTO';
        }

        return {
            id,
            senha,
            estado,
            dataEmissao: o.PEV_DT_EMISSAO,
            dataLancamento: o.PEV_DT_LANCAMENTO,
            valorTotal: parseFloat(o.PEV_VALOR_TOTAL) || 0,
            statusVenda: o.PEV_STATUS,
            dtPronto: o.PEV_DT_HR_PRONTO,
            dtEntregue: o.PEV_DT_HR_ENTREGUE,
            clienteNome: (o.PEV_NOME || '').trim(),
            mesa: (o.PEV_MESA || '').trim(),
            comanda: (o.PEV_COMANDA || '').trim(),
            itens: itemsByOrder[id] || []
        };
    });
}

async function updateOrderStatus(orderId, action) {
    const id = parseInt(orderId, 10);
    if (!id) throw httpError(400, 'ID do pedido inválido');

    const existe = await query(`SELECT PEV_STATUS FROM TB_PEDIDO_VENDA WHERE PEV_ID = ${id}`);
    if (existe.length === 0) throw httpError(404, 'Pedido não encontrado');
    if (action !== 'REABRIR' && String(existe[0].PEV_STATUS || '').toUpperCase() === 'C') {
        throw httpError(400, 'Pedido cancelado não pode ser alterado');
    }

    // COALESCE: repetir a acao nao sobrescreve o horario original (preserva o tempo de preparo)
    let sql = '';
    if (action === 'PRONTO') {
        sql = `UPDATE TB_PEDIDO_VENDA SET PEV_DT_HR_PRONTO = COALESCE(PEV_DT_HR_PRONTO, CURRENT_TIMESTAMP) WHERE PEV_ID = ${id}`;
    } else if (action === 'ENTREGUE') {
        sql = `UPDATE TB_PEDIDO_VENDA SET PEV_DT_HR_ENTREGUE = COALESCE(PEV_DT_HR_ENTREGUE, CURRENT_TIMESTAMP) WHERE PEV_ID = ${id}`;
    } else if (action === 'REABRIR') {
        sql = `UPDATE TB_PEDIDO_VENDA SET PEV_DT_HR_PRONTO = NULL, PEV_DT_HR_ENTREGUE = NULL WHERE PEV_ID = ${id}`;
    } else {
        throw httpError(400, `Ação inválida: ${action}`);
    }

    await execute(sql);
    return { id, action, success: true };
}

async function assignOrderPassword(orderId, senha) {
    const id = parseInt(orderId, 10);
    if (!id) throw httpError(400, 'ID do pedido inválido');
    // PEV_SENHA e INTEGER no banco
    const senhaStr = String(senha === null || senha === undefined ? '' : senha).trim();
    if (!/^\d{1,9}$/.test(senhaStr)) throw httpError(400, 'A senha deve ser numérica');
    const existe = await query(`SELECT 1 AS OK FROM TB_PEDIDO_VENDA WHERE PEV_ID = ${id}`);
    if (existe.length === 0) throw httpError(404, 'Pedido não encontrado');
    await execute(`UPDATE TB_PEDIDO_VENDA SET PEV_SENHA = ${parseInt(senhaStr, 10)} WHERE PEV_ID = ${id}`);
    return { id, senha: senhaStr.padStart(2, '0'), success: true };
}

// --- Padroes do PDV (derivados dos pedidos reais do ERP; evita "chumbar" cliente/natureza/caixa) ---
let pdvCache = null;
async function pdvDefaults() {
    if (pdvCache && Date.now() - pdvCache.t < 10 * 60 * 1000) return pdvCache.v;
    const v = { cliente: null, guidCliente: null, natureza: 102, caixa: 1, local: 1, frete: 9, usuario: 1 };
    try {
        const r = await query(`
SELECT FIRST 1 PEV_CLIENTE, PEV_NATUREZA_OPERACAO, PEV_CAIXA, PEV_LOCAL_ESTOQUE, PEV_TIPO_FRETE, PEV_USUARIO, COUNT(*) AS N
FROM TB_PEDIDO_VENDA
WHERE PEV_STATUS = 'F' AND PEV_CLIENTE IS NOT NULL AND PEV_LOCAL_ESTOQUE IS NOT NULL AND PEV_USUARIO IS NOT NULL
  AND PEV_DT_EMISSAO >= DATEADD(-90 DAY TO (SELECT MAX(PEV_DT_EMISSAO) FROM TB_PEDIDO_VENDA WHERE PEV_STATUS = 'F'))
GROUP BY PEV_CLIENTE, PEV_NATUREZA_OPERACAO, PEV_CAIXA, PEV_LOCAL_ESTOQUE, PEV_TIPO_FRETE, PEV_USUARIO
ORDER BY 7 DESC`);
        if (r[0]) {
            const num = (x, d) => (x !== null && x !== undefined && isFinite(parseInt(x, 10)) ? parseInt(x, 10) : d);
            v.cliente = num(r[0].PEV_CLIENTE, null);
            v.natureza = num(r[0].PEV_NATUREZA_OPERACAO, v.natureza);
            v.caixa = num(r[0].PEV_CAIXA, v.caixa);
            v.local = num(r[0].PEV_LOCAL_ESTOQUE, v.local);
            v.frete = num(r[0].PEV_TIPO_FRETE, v.frete);
            v.usuario = num(r[0].PEV_USUARIO, v.usuario);
            if (v.cliente !== null) {
                const g = await query(`SELECT FIRST 1 PEV_GUID_CLIENTE FROM TB_PEDIDO_VENDA WHERE PEV_CLIENTE = ${v.cliente} AND PEV_GUID_CLIENTE IS NOT NULL ORDER BY PEV_ID DESC`);
                if (g[0] && /^[0-9A-Fa-f-]{36}$/.test(String(g[0].PEV_GUID_CLIENTE))) v.guidCliente = String(g[0].PEV_GUID_CLIENTE);
            }
        }
    } catch (e) {
        console.warn('Padroes do PDV (usando valores basicos):', e.message);
    }
    pdvCache = { t: Date.now(), v };
    return v;
}

// Executa varias instrucoes numa unica transacao devolvendo o resultado do callback (rollback em qualquer erro)
function runTransaction(work) {
    return withConn((conn) => new Promise((resolve, reject) => {
        conn.transaction(Firebird.ISOLATION_READ_COMMITTED, (err, tr) => {
            if (err) return reject(err);
            const q = (sql, params = []) => new Promise((res, rej) => tr.query(sql, params, (e, r) => (e ? rej(e) : res(r))));
            (async () => {
                let out;
                try {
                    out = await work(q);
                } catch (e) {
                    return tr.rollback(() => reject(e));
                }
                tr.commit((e) => (e ? reject(e) : resolve(out)));
            })();
        });
    }));
}

const guidNovo = () => require('crypto').randomUUID().toUpperCase();

// Cria um pedido "aberto" (status A) com os MESMOS campos que o PDV do ERP grava numa comanda aberta,
// para que o caixa consiga abrir/finalizar o pedido no ERP (cliente, natureza, estoque, totais, GUIDs...).
async function createQuickTicket({ nome = '', comanda = '', mesa = '', senha = null, itens = [], valorTotal = 0, desconto = 0 }) {
    return withLock(async () => {
        const seqCond = `SEQ_TABELA = 'TB_PEDIDO_VENDA' AND (SEQ_EMPRESA = 1 OR SEQ_EMPRESA IS NULL)`;

        // Dentro do lock: senha do dia e numero do pedido nao colidem entre requisicoes
        // PEV_SENHA e PEV_MESA sao INTEGER no banco (verificado em RDB$FIELDS)
        const senhaStr = String(senha !== null && senha !== undefined && String(senha).trim() !== ''
            ? senha : await generateNextDailyPassword()).trim();
        if (!/^\d{1,9}$/.test(senhaStr)) throw httpError(400, 'A senha deve ser numérica');
        const senhaNum = parseInt(senhaStr, 10);
        const finalSenha = senhaStr.length < 2 ? senhaStr.padStart(2, '0') : senhaStr; // so para exibir
        const mesaStr = String(mesa === null || mesa === undefined ? '' : mesa).trim();
        if (mesaStr !== '' && !/^\d{1,9}$/.test(mesaStr)) throw httpError(400, 'A mesa deve ser numérica');
        const mesaSql = mesaStr === '' ? 'NULL' : String(parseInt(mesaStr, 10));
        const safeNome = sqlStr(nome, 100);
        const safeComanda = sqlStr(comanda, 30);
        const safeMesa = mesaStr;

        // Valor total recalculado a partir dos itens (nao confia no valor do cliente)
        const lista = Array.isArray(itens) ? itens : [];
        const itensOk = lista.map(item => {
            const qtd = parseFloat(item.quantidade);
            const unit = parseFloat(item.valorUnitario);
            return {
                produtoId: parseInt(item.produtoId, 10) || 0,
                descricao: item.descricao || 'Item',
                quantidade: isFinite(qtd) && qtd > 0 ? qtd : 1,
                valorUnitario: isFinite(unit) && unit >= 0 ? unit : 0
            };
        });
        const subtotal = itensOk.length > 0
            ? itensOk.reduce((s, i) => s + i.quantidade * i.valorUnitario, 0)
            : (isFinite(parseFloat(valorTotal)) ? parseFloat(valorTotal) : 0);

        // Desconto (cupom): validado no servidor; o total nunca fica negativo
        const descontoOk = isFinite(parseFloat(desconto)) && parseFloat(desconto) > 0 ? Math.min(parseFloat(desconto), subtotal) : 0;
        const total = Math.max(0, subtotal - descontoOk);

        // Dados do cadastro de cada produto (unidade, tipo e custo) e padroes do PDV
        const def = await pdvDefaults();
        if (mesaStr !== '') {
            const m = await query(`SELECT 1 AS OK FROM TB_MESA WHERE MSA_ID = ${parseInt(mesaStr, 10)}`);
            if (m.length === 0) throw httpError(400, `Mesa ${parseInt(mesaStr, 10)} não está cadastrada no ERP`);
        }
        const prodIds = [...new Set(itensOk.map((i) => i.produtoId).filter((n) => n > 0))];
        const prod = {};
        if (prodIds.length > 0) {
            const rows = await query(`SELECT PRD_ID, PRD_UN_VENDA, PRD_TIPO_PRODUTO, PRD_PRECO_CUSTO FROM TB_PRODUTO WHERE PRD_ID IN (${prodIds.join(',')})`);
            rows.forEach((r) => { prod[parseInt(r.PRD_ID, 10)] = r; });
        }
        const semProduto = itensOk.find((i) => !prod[i.produtoId]);
        if (semProduto) throw httpError(400, `Produto ${semProduto.produtoId || '(sem código)'} não encontrado no cadastro`);

        const n2 = (v) => Number(v).toFixed(4);
        const q1 = (s) => `'${sqlStr(s, 100)}'`;
        const clienteSql = def.cliente === null ? 'NULL' : String(def.cliente);
        const guidClienteSql = def.guidCliente ? `'${def.guidCliente}'` : 'NULL';

        const pedId = await runTransaction(async (q) => {
            // UPDATE primeiro (trava a linha); o numero lido e unico mesmo com o ERP gravando junto
            await q(`UPDATE TB_SEQUENCIAL SET SEQ_SEQUENCIAL = SEQ_SEQUENCIAL + 1 WHERE ${seqCond}`);
            const seq = await q(`SELECT SEQ_SEQUENCIAL FROM TB_SEQUENCIAL WHERE ${seqCond}`);
            const id = parseInt(seq && seq[0] && seq[0].SEQ_SEQUENCIAL, 10);
            if (!Number.isInteger(id)) throw new Error('Sequencial de pedidos nao encontrado (TB_SEQUENCIAL)');

            await q(`
INSERT INTO TB_PEDIDO_VENDA (
    PEV_EMPRESA, PEV_ID, PEV_DT_EMISSAO, PEV_CLIENTE, PEV_DT_LANCAMENTO, PEV_USUARIO,
    PEV_SUB_TOTAL, PEV_VALOR_TOTAL, PEV_VALOR_DESCONTO, PEV_VALOR_ACRESCIMO, PEV_STATUS, PEV_QTDE_ITENS,
    PEV_DT_ENTREGA, PEV_AJUSTE, PEV_TIPO_FRETE, PEV_VOLUME, PEV_NATUREZA_OPERACAO,
    PEV_ACRESC_DESC_NF, PEV_TIPO_DESCONTO, PEV_DESCONTO, PEV_DESTACAR_TRANSP, PEV_SELECIONADO, PEV_CAIXA,
    PEV_TIPO_ACRESCIMO, PEV_PRECO_VENDA_CUSTO, PEV_VALOR_TOTAL_RECEBER, PEV_VALOR_DIFERENCA,
    PEV_GERA_FINANCEIRO, PEV_TIPO_TELA, PEV_MOV_ESTOQUE, PEV_NOME, PEV_CLIENTE_NAO_REG, PEV_COMANDA, PEV_MESA,
    PEV_DT_HR_ATEDIMENTO, PEV_DELIVERY, PEV_AGUARDANDO, PEV_VENDER_CREDITO, PEV_LOCAL_ESTOQUE, PEV_QTDE_PESSOAS,
    PEV_VALOR_PESSOA, PEV_BALCAO, PEV_ABERTO, PEV_ALTERAR_TABELA, PEV_VALOR_PEDIDO, PEV_GUID, PEV_GUID_CLIENTE,
    PEV_ULTIMA_ALTERACAO, PEV_MOV_ESTOQUE_VENDA, PEV_SENHA,
    PEV_VALOR_COMISSAO, PEV_LIMITE_CREDITO, PEV_LIMITE_DISPONIVEL, PEV_LIMITE_UTILIZADO, PEV_TOTAL_NOTA,
    PEV_VALOR_TOTAL_RECEBIDO, PEV_VALOR_IMPOSTO, PEV_PESO_LIQUIDO, PEV_PESO_BRUTO, PEV_METRAGEM_CUBICA,
    PEV_DESP_ACESSORIA, PEV_SALDO_FLEX, PEV_VALOR_TOTAL_PARCELADO, PEV_PLANO_CONTAS, PEV_IND_PRESENCA,
    PEV_VALOR_DESCARTE, PEV_VALOR_COMPL_ADD, PEV_VALOR_COMPL_RET, PEV_TOTAL_TX_SERV, PEV_DURACAO_PEDIDO,
    PEV_VALOR_IPI, PEV_VALOR_ST, PEV_VALOR_ICMS_DESON, PEV_VALOR_RETENCAO_TRIB, PEV_TOTAL_CASHBACK,
    PEV_VALOR_PROMOCAO, PEV_NAO_APLICAR_PROMOCAO, PEV_VALOR_ACRES_FIN, PEV_VALOR_DESC_FIN, PEV_VALOR_ICMS,
    PEV_VALOR_ICMS_DIFAL, PEV_REGRA_TRIBUTARIA
) VALUES (
    1, ${id}, CURRENT_DATE, ${clienteSql}, CURRENT_TIMESTAMP, ${def.usuario},
    ${n2(subtotal)}, ${n2(total)}, ${n2(descontoOk)}, 0, 'A', ${itensOk.length},
    CURRENT_DATE, 0, ${def.frete}, 1, ${def.natureza},
    'T', 'V', ${n2(descontoOk)}, 'N', 'N', ${def.caixa},
    'V', 'V', ${n2(total)}, ${n2(-total)},
    'S', 'T', 'S', ${q1(safeNome)}, 'S', ${q1(safeComanda)}, ${mesaSql},
    CURRENT_TIMESTAMP, 'N', 'N', 'N', ${def.local}, 1,
    ${n2(total)}, 'N', 'N', 'S', ${n2(subtotal)}, '${guidNovo()}', ${guidClienteSql},
    CURRENT_TIMESTAMP, 'F', ${senhaNum},
    0, -1, 0, 1, 0,
    0, 0, 0, 0, 0,
    0, 0, 0, 0, 1,
    0, 0, 0, 0, 0,
    0, 0, 0, 0, 0,
    0, 'N', 0, 0, 0,
    0, 0
)`);

            // desconto do cupom rateado entre os itens (a ultima linha absorve o centavo de arredondamento)
            let restante = Math.round(descontoOk * 100) / 100;
            for (let idx = 0; idx < itensOk.length; idx++) {
                const item = itensOk[idx];
                const bruto = item.quantidade * item.valorUnitario;
                let rateio = 0;
                if (restante > 0 && subtotal > 0) {
                    rateio = idx === itensOk.length - 1
                        ? restante
                        : Math.min(restante, Math.round(((descontoOk * bruto) / subtotal) * 100) / 100);
                    restante = Math.round((restante - rateio) * 100) / 100;
                }
                const info = prod[item.produtoId] || {};
                const un = sqlStr(info.PRD_UN_VENDA || 'UN', 6);
                const tipoProd = sqlStr(info.PRD_TIPO_PRODUTO || 'N', 1);
                const custo = isFinite(parseFloat(info.PRD_PRECO_CUSTO)) ? parseFloat(info.PRD_PRECO_CUSTO) : 0;
                await q(`
INSERT INTO TB_PEDIDO_VENDA_ITEM (
    PEVI_EMPRESA, PEVI_PEDIDO_VENDA, PEVI_SEQUENCIA, PEVI_PRODUTO, PEVI_QUANTIDADE, PEVI_UN_VENDA,
    PEVI_VALOR_UNITARIO, PEVI_VALOR_DESCONTO, PEVI_VALOR_TOTAL, PEVI_VALOR_ACRESCIMO, PEVI_VALOR_FRETE,
    PEVI_QTDE_ESTOQUE, PEVI_SUB_TOTAL, PEVI_VALOR_COMISSAO, PEVI_DESCRICAO, PEVI_DESCONTO, PEVI_ACRESCIMO,
    PEVI_COMISSAO, PEVI_QTDE_CONVERSAO, PEVI_TIPO_PRODUTO, PEVI_QUANTIDADE_NF, PEVI_VALOR_UNITARIO_NF,
    PEVI_VALOR_TOTAL_NF, PEVI_DESC_RATEADO, PEVI_ACRESC_RATEADO, PEVI_TIPO_DESCONTO, PEVI_TIPO_ACRESCIMO,
    PEVI_APLICA_DESCONTO, PEVI_UNITARIO_FLEX, PEVI_TOTAL_FLEX, PEVI_SALDO_FLEX, PEVI_STATUS_VALOR,
    PEVI_COD_DIGITADO, PEVI_ORIGEM_CODIGO, PEVI_VOLUME_ITEM, PEVI_VOLUME, PEVI_DT_LANCAMENTO,
    PEVI_IMPRESSO, PEVI_RECENTE, PEVI_ENTREGUE, PEVI_SISTEMA, PEVI_STATUS_FLEX, PEVI_VALOR_VOLUME,
    PEVI_VALOR_CUSTO_UNITARIO, PEVI_APLICAR_TX_SERVICO, PEVI_VARIACAO, PEVI_LOCAL_ESTOQUE, PEVI_GUID,
    PEVI_METRAGEM, PEVI_PESO_BRUTO, PEVI_PESO_LIQUIDO, PEVI_VALOR_DESCARTE, PEVI_VALOR_COMPL_ADD,
    PEVI_VALOR_COMPL_RET, PEVI_AREA_CAIXA, PEVI_VALOR_DESC_PROMO, PEVI_QTDE_PROMOCAO, PEVI_IVA, PEVI_IVA_VALOR
) VALUES (
    1, ${id}, ${idx + 1}, ${item.produtoId}, ${n2(item.quantidade)}, '${un}',
    ${n2(item.valorUnitario)}, 0, ${n2(bruto - rateio)}, 0, 0,
    ${n2(item.quantidade)}, ${n2(bruto)}, 0, ${q1(item.descricao)}, 0, 0,
    0, 1, '${tipoProd}', ${n2(item.quantidade)}, 0,
    0, ${n2(rateio)}, 0, 'V', 'V',
    'S', ${n2(item.valorUnitario)}, ${n2(bruto)}, ${n2(-rateio)}, 'N',
    '${item.produtoId}', 'ID', 1, 1, CURRENT_TIMESTAMP,
    'S', 'N', 'N', 'S', 'N', ${n2(bruto)},
    ${n2(custo)}, 'S', 0, ${def.local}, '${guidNovo()}',
    0, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0
)`);
            }
            return id;
        });

        return {
            id: pedId,
            senha: finalSenha,
            nome: safeNome,
            comanda: safeComanda,
            mesa: safeMesa,
            valorTotal: total,
            desconto: descontoOk,
            itens: itensOk,
            success: true
        };
    });
}

async function getCompanyInfo() {
    try {
        const rows = await query("SELECT FIRST 1 EMP_ID, EMP_FANTASIA, EMP_RAZAO_SOCIAL, EMP_CNPJ, EMP_TELEFONE, EMP_EMAIL, EMP_ENDERECO FROM TB_EMPRESA WHERE EMP_STATUS = 'A'");
        if (rows && rows.length > 0) {
            const r = rows[0];
            return {
                id: r.EMP_ID,
                fantasia: r.EMP_FANTASIA ? r.EMP_FANTASIA.trim() : 'DUSUCO',
                razaoSocial: r.EMP_RAZAO_SOCIAL ? r.EMP_RAZAO_SOCIAL.trim() : 'DUSUCO LTDA',
                cnpj: r.EMP_CNPJ ? r.EMP_CNPJ.trim() : '',
                telefone: r.EMP_TELEFONE ? r.EMP_TELEFONE.trim() : '',
                email: r.EMP_EMAIL ? r.EMP_EMAIL.trim() : '',
                endereco: r.EMP_ENDERECO ? r.EMP_ENDERECO.trim() : ''
            };
        }
    } catch (e) {
        console.warn('Aviso ao consultar TB_EMPRESA:', e.message);
    }
    return {
        id: '1',
        fantasia: 'DUSUCO',
        razaoSocial: 'DUSUCO LTDA',
        cnpj: '',
        telefone: '',
        email: '',
        endereco: ''
    };
}

// --- Promocoes: visao ativa / futura / vencida ---
function hojeStr() {
    const d = new Date();
    return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`;
}
function diffDias(ymdA, ymdB) {
    const [a1, a2, a3] = ymdA.split('-').map(Number);
    const [b1, b2, b3] = ymdB.split('-').map(Number);
    return Math.round((Date.UTC(b1, b2 - 1, b3) - Date.UTC(a1, a2 - 1, a3)) / 86400000);
}

// estado: ATIVAS | EXPIRANDO | FUTURAS | VENCIDAS | TODAS. diasAlerta: janela de "expirando".
async function getPromotions({ estado = 'TODAS', diasAlerta = 3 } = {}) {
    diasAlerta = Math.min(60, Math.max(0, parseInt(diasAlerta, 10) || 0));
    const rows = await query(`
SELECT P.PRD_ID, P.PRD_CODIGO, P.PRD_DESCRICAO, P.PRD_STATUS, P.PRD_UN_VENDA, P.PRD_PRECO_VENDA,
       P.PRD_VALOR_PROM, P.PRD_DT_INI_PROM, P.PRD_DT_FIM_PROM, P.PRD_ULTIMA_ALTERACAO,
       COALESCE(E.PRDE_ESTOQUE, 0) AS ESTOQUE,
       (CASE WHEN (P.PRD_FOTO IS NOT NULL AND TRIM(P.PRD_FOTO) <> '') OR P.PRD_IMAGEM IS NOT NULL THEN 1 ELSE 0 END) AS TEM_FOTO
FROM TB_PRODUTO P
LEFT JOIN TB_PRODUTO_ESTOQUE E ON (E.PRDE_PRODUTO = P.PRD_ID AND E.PRDE_EMPRESA = 1)
WHERE P.PRD_TIPO_PRODUTO IN ('N', 'P', 'T') AND P.PRD_VALOR_PROM IS NOT NULL AND P.PRD_VALOR_PROM > 0
ORDER BY P.PRD_DT_FIM_PROM, P.PRD_DESCRICAO`);

    const hoje = hojeStr();
    const todos = rows.map((r) => {
        const precoVenda = parseFloat(r.PRD_PRECO_VENDA) || 0;
        const precoPromocao = parseFloat(r.PRD_VALOR_PROM) || 0;
        const ini = r.PRD_DT_INI_PROM ? r.PRD_DT_INI_PROM.substring(0, 10) : null;
        const fim = r.PRD_DT_FIM_PROM ? r.PRD_DT_FIM_PROM.substring(0, 10) : null;
        let situacao = 'ATIVA';
        if (fim && fim < hoje) situacao = 'VENCIDA';
        else if (ini && ini > hoje) situacao = 'FUTURA';
        const diasParaFim = fim ? diffDias(hoje, fim) : null;
        const diasParaInicio = ini ? diffDias(hoje, ini) : null;
        return {
            id: parseInt(r.PRD_ID, 10),
            codigo: r.PRD_CODIGO || '',
            descricao: r.PRD_DESCRICAO || '',
            status: r.PRD_STATUS || 'A',
            unidade: r.PRD_UN_VENDA || 'UN',
            precoVenda,
            precoPromocao,
            descontoPercentual: precoVenda > 0 ? Math.round(((precoVenda - precoPromocao) / precoVenda) * 100) : 0,
            dtInicioProm: ini,
            dtFimProm: fim,
            situacao,
            diasParaFim,
            diasParaInicio,
            expirando: situacao === 'ATIVA' && diasParaFim !== null && diasParaFim <= diasAlerta,
            estoque: parseFloat(r.ESTOQUE) || 0,
            temFoto: r.TEM_FOTO === '1',
            ultimaAlteracao: r.PRD_ULTIMA_ALTERACAO
        };
    });

    const contagem = {
        todas: todos.length,
        ativas: todos.filter((p) => p.situacao === 'ATIVA').length,
        expirando: todos.filter((p) => p.expirando).length,
        futuras: todos.filter((p) => p.situacao === 'FUTURA').length,
        vencidas: todos.filter((p) => p.situacao === 'VENCIDA').length
    };

    let itens = todos;
    if (estado === 'ATIVAS') itens = todos.filter((p) => p.situacao === 'ATIVA');
    else if (estado === 'EXPIRANDO') itens = todos.filter((p) => p.expirando);
    else if (estado === 'FUTURAS') itens = todos.filter((p) => p.situacao === 'FUTURA');
    else if (estado === 'VENCIDAS') itens = todos.filter((p) => p.situacao === 'VENCIDA');

    return { hoje, diasAlerta, contagem, itens };
}

// --- Edicao em lote ---
const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

// acao: STATUS {status:'A'|'I'} | PRECO_PERCENTUAL {percentual} |
//       PROMOCAO_PERCENTUAL {percentual, dtInicio?, dtFim?} | PROMOCAO_REMOVER
async function batchUpdateProducts({ ids, acao, params = {} } = {}) {
    if (!Array.isArray(ids) || ids.length === 0) throw httpError(400, 'Selecione ao menos um produto');
    const lista = [...new Set(ids.map((v) => parseInt(v, 10)).filter((v) => Number.isInteger(v) && v > 0))];
    if (lista.length === 0) throw httpError(400, 'Nenhum ID válido informado');
    if (lista.length > 200) throw httpError(400, 'Máximo de 200 produtos por operação');

    const acoes = ['STATUS', 'PRECO_PERCENTUAL', 'PROMOCAO_PERCENTUAL', 'PROMOCAO_REMOVER'];
    if (!acoes.includes(acao)) throw httpError(400, 'Ação inválida: ' + acao);

    // Validacao dos parametros uma unica vez (antes de tocar em qualquer produto)
    let pct = null;
    let dtInicio = null;
    let dtFim = null;
    if (acao === 'STATUS') {
        if (params.status !== 'A' && params.status !== 'I') throw httpError(400, "Status deve ser 'A' ou 'I'");
    } else if (acao === 'PRECO_PERCENTUAL') {
        pct = Number(params.percentual);
        if (!isFinite(pct) || pct === 0 || pct < -90 || pct > 200) throw httpError(400, 'Percentual deve estar entre -90 e 200 (diferente de 0)');
    } else if (acao === 'PROMOCAO_PERCENTUAL') {
        pct = Number(params.percentual);
        if (!isFinite(pct) || pct < 1 || pct > 90) throw httpError(400, 'Desconto deve estar entre 1% e 90%');
        dtInicio = sqlDate(params.dtInicio) || hojeStr();
        dtFim = sqlDate(params.dtFim);
        if (dtFim && dtFim < hojeStr()) throw httpError(400, 'A data de término já passou');
        if (dtFim && dtFim < dtInicio) throw httpError(400, 'A data de término não pode ser anterior ao início');
    }

    const resultados = [];
    for (const id of lista) {
        try {
            const cur = await getProductById(id);
            if (!cur) throw httpError(404, 'Produto não encontrado');
            let detalhe = '';
            if (acao === 'STATUS') {
                await updateProductStatus(id, params.status);
                detalhe = params.status === 'A' ? 'Ativado' : 'Inativado';
            } else if (acao === 'PRECO_PERCENTUAL') {
                const novo = round2(cur.precoVenda * (1 + pct / 100));
                if (!(novo > 0)) throw httpError(400, 'Preço resultante inválido');
                if (cur.emPromocao && cur.precoPromocao >= novo) throw httpError(400, 'Novo preço ficaria menor ou igual ao promocional');
                await updateProductPrice(id, novo);
                detalhe = `${cur.precoVenda.toFixed(2)} → ${novo.toFixed(2)}`;
            } else if (acao === 'PROMOCAO_PERCENTUAL') {
                if (!(cur.precoVenda > 0)) throw httpError(400, 'Produto sem preço de venda');
                const promo = round2(cur.precoVenda * (1 - pct / 100));
                if (!(promo > 0) || promo >= cur.precoVenda) throw httpError(400, 'Preço promocional inválido');
                await updateProductPromotion(id, { ativo: true, valorPromocional: promo, dtInicio, dtFim, tipoValor: 'V' });
                detalhe = `Promoção ${promo.toFixed(2)} (-${pct}%)`;
            } else if (acao === 'PROMOCAO_REMOVER') {
                if (!(cur.precoPromocao > 0)) { resultados.push({ id, descricao: cur.descricao, ok: true, detalhe: 'Sem promoção (ignorado)' }); continue; }
                await updateProductPromotion(id, { ativo: false });
                detalhe = 'Promoção removida';
            }
            resultados.push({ id, descricao: cur.descricao, ok: true, detalhe });
        } catch (err) {
            resultados.push({ id, ok: false, erro: err.message });
        }
    }
    const ok = resultados.filter((r) => r.ok).length;
    return { total: resultados.length, ok, falhas: resultados.length - ok, resultados };
}

// --- Assinaturas de mudanca (alimentam os eventos em tempo real) ---
async function getChangeSignatures() {
    const [o] = await query(`SELECT COUNT(*) AS N, MAX(PEV_ID) AS MX,
        SUM(CASE WHEN PEV_DT_HR_PRONTO IS NULL THEN 0 ELSE 1 END) AS PR,
        SUM(CASE WHEN PEV_DT_HR_ENTREGUE IS NULL THEN 0 ELSE 1 END) AS EN,
        SUM(CASE WHEN PEV_STATUS = 'C' THEN 1 ELSE 0 END) AS CA,
        SUM(COALESCE(PEV_SENHA, 0)) AS SN,
        SUM(COALESCE(PEV_VALOR_TOTAL, 0)) AS VT
        FROM TB_PEDIDO_VENDA WHERE PEV_DT_EMISSAO = CURRENT_DATE`);
    const [p] = await query(`SELECT COUNT(*) AS N, MAX(PRD_ULTIMA_ALTERACAO) AS U,
        SUM(CASE WHEN PRD_VALOR_PROM > 0 THEN 1 ELSE 0 END) AS PV
        FROM TB_PRODUTO WHERE PRD_TIPO_PRODUTO IN ('N', 'P', 'T')`);
    const [e] = await query('SELECT MAX(PRDE_ULTIMA_ALTERACAO) AS U FROM TB_PRODUTO_ESTOQUE WHERE PRDE_EMPRESA = 1');
    return {
        orders: JSON.stringify(o),
        products: JSON.stringify([p, e, hojeStr()])
    };
}

module.exports = {
    getDbConfig,
    testDbConfig,
    saveDbConfig,
    query,
    execute,
    getProducts,
    getProductById,
    getProductImage,
    saveProductImage,
    updateProductStatus,
    updateProductPrice,
    updateProductPromotion,
    updateProductStock,
    quickEditProduct,
    updateProductFields,
    getProductSalesHistory,
    getAuditHistory,
    getDashboardStats,
    getTvPromotions,
    getOrders,
    updateOrderStatus,
    assignOrderPassword,
    generateNextDailyPassword,
    createQuickTicket,
    getCompanyInfo,
    logAudit,
    getPromotions,
    batchUpdateProducts,
    getChangeSignatures,
    runStatements,
    isPromoVigente,
    hexToWin1252,
    get connectionInfo() {
        return { host: fbOptions.host, port: fbOptions.port, database: fbOptions.database };
    }
};

