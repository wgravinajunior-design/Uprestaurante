// Área pública (clientes): acompanhamento de senha e cardápio digital.
//
// Roda numa PORTA SEPARADA (padrão 8083) que expõe apenas rotas de LEITURA e dados mínimos. Assim a rede
// de visitantes pode alcançar a porta 8083 sem alcançar a API administrativa (8080), que altera preços e estoque.
const express = require('express');
const fs = require('fs');
const path = require('path');
const os = require('os');
const db = require('./db');

const configDir = process.env.CONFIG_DIR || path.join(__dirname, '..', 'config');
const cardapioFile = path.join(configDir, 'cardapio.json');

// ---------------------------------------------------------------------------
// Configuração do cardápio digital
// ---------------------------------------------------------------------------
const CARDAPIO_PADRAO = {
    ocultarSemFoto: false,     // esconde produtos sem foto
    ocultarSemEstoque: false,  // esconde produtos com estoque <= 0 (atenção: o ERP tem muitos negativos)
    incluirSemGrupo: true,     // produtos sem grupo entram na seção "Outros"
    respeitarTouch: true,      // só grupos marcados "exibir no touch" (PGRU_EXIBIR_TOUCH = 'S')
    mostrarDescricao: true,    // usa a observação do produto como descrição
    ocultos: []                // IDs de produtos escondidos manualmente
};

function getCardapioConfig() {
    try {
        if (fs.existsSync(cardapioFile)) {
            const c = JSON.parse(fs.readFileSync(cardapioFile, 'utf8'));
            return { ...CARDAPIO_PADRAO, ...c, ocultos: Array.isArray(c.ocultos) ? c.ocultos : [] };
        }
    } catch (e) {
        console.warn('Erro ao ler cardapio.json:', e.message);
    }
    return { ...CARDAPIO_PADRAO };
}

function saveCardapioConfig(entrada) {
    const e = entrada || {};
    const atual = getCardapioConfig();
    const bool = (k) => (e[k] === undefined ? atual[k] : e[k] === true || e[k] === 'true');
    const cfg = {
        ocultarSemFoto: bool('ocultarSemFoto'),
        ocultarSemEstoque: bool('ocultarSemEstoque'),
        incluirSemGrupo: bool('incluirSemGrupo'),
        respeitarTouch: bool('respeitarTouch'),
        mostrarDescricao: bool('mostrarDescricao'),
        ocultos: e.ocultos === undefined
            ? atual.ocultos
            : [...new Set((Array.isArray(e.ocultos) ? e.ocultos : []).map((n) => parseInt(n, 10)).filter((n) => Number.isInteger(n) && n > 0))].slice(0, 2000)
    };
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(cardapioFile, JSON.stringify(cfg, null, 2), 'utf8');
    menuCache = null;
    return cfg;
}

// ---------------------------------------------------------------------------
// Cardápio
// ---------------------------------------------------------------------------
let menuCache = null;
const MENU_TTL_MS = 15000;

function round2(n) {
    return Math.round((n + Number.EPSILON) * 100) / 100;
}

async function buildMenu() {
    if (menuCache && Date.now() - menuCache.t < MENU_TTL_MS) return menuCache.data;

    const cfg = getCardapioConfig();
    const rows = await db.query(
        `SELECT P.PRD_ID, P.PRD_CODIGO, P.PRD_DESCRICAO, P.PRD_UN_VENDA, P.PRD_PRECO_VENDA, P.PRD_VALOR_PROM,
                P.PRD_DT_INI_PROM, P.PRD_DT_FIM_PROM, P.PRD_ULTIMA_ALTERACAO, P.PRD_GRUPO,
                G.PGRU_DESCRICAO AS GRUPO_NOME, G.PGRU_EXIBIR_TOUCH AS GRUPO_TOUCH, G.PGRU_ORDEM_TOUCH AS GRUPO_ORDEM,
                COALESCE(E.PRDE_ESTOQUE, 0) AS ESTOQUE,
                (CASE WHEN (P.PRD_FOTO IS NOT NULL AND TRIM(P.PRD_FOTO) <> '') OR P.PRD_IMAGEM IS NOT NULL THEN 1 ELSE 0 END) AS TEM_FOTO,
                CAST(SUBSTRING(P.PRD_OBSERVACAO FROM 1 FOR 300) AS VARCHAR(300) CHARACTER SET OCTETS) AS OBS
         FROM TB_PRODUTO P
         LEFT JOIN TB_PROD_GRUPO G ON (G.PGRU_ID = P.PRD_GRUPO)
         LEFT JOIN TB_PRODUTO_ESTOQUE E ON (E.PRDE_PRODUTO = P.PRD_ID AND E.PRDE_EMPRESA = 1)
         WHERE P.PRD_TIPO_PRODUTO IN ('N', 'P', 'T') AND P.PRD_STATUS IN ('A', 'P') AND P.PRD_PRECO_VENDA > 0`);

    const ocultos = new Set(cfg.ocultos);
    const secoes = new Map();
    const promocoes = [];

    for (const r of rows) {
        const id = parseInt(r.PRD_ID, 10);
        if (ocultos.has(id)) continue;
        const temFoto = r.TEM_FOTO === '1';
        const estoque = parseFloat(r.ESTOQUE) || 0;
        if (cfg.ocultarSemFoto && !temFoto) continue;
        if (cfg.ocultarSemEstoque && estoque <= 0) continue;

        const grupoId = r.PRD_GRUPO !== null && r.PRD_GRUPO !== undefined ? parseInt(r.PRD_GRUPO, 10) : null;
        let secaoId;
        let secaoNome;
        let ordem = 9000;
        if (grupoId === null || !r.GRUPO_NOME) {
            if (!cfg.incluirSemGrupo) continue;
            secaoId = 'outros';
            secaoNome = 'Outros';
            ordem = 99999;
        } else {
            if (cfg.respeitarTouch && r.GRUPO_TOUCH !== 'S') continue;
            secaoId = `g${grupoId}`;
            secaoNome = r.GRUPO_NOME;
            const o = parseInt(r.GRUPO_ORDEM, 10);
            ordem = Number.isInteger(o) ? o : 9000;
        }

        const preco = round2(parseFloat(r.PRD_PRECO_VENDA) || 0);
        const prom = round2(parseFloat(r.PRD_VALOR_PROM) || 0);
        const emPromocao = db.isPromoVigente(prom, r.PRD_DT_INI_PROM, r.PRD_DT_FIM_PROM) && prom < preco;
        const obs = cfg.mostrarDescricao ? db.hexToWin1252(r.OBS) : '';

        const item = {
            id,
            nome: r.PRD_DESCRICAO || `Produto ${id}`,
            descricao: obs.length > 160 ? obs.substring(0, 157) + '…' : obs,
            unidade: r.PRD_UN_VENDA || 'UN',
            preco,
            precoPromocao: emPromocao ? prom : null,
            descontoPercentual: emPromocao && preco > 0 ? Math.round(((preco - prom) / preco) * 100) : 0,
            promoAte: emPromocao && r.PRD_DT_FIM_PROM ? String(r.PRD_DT_FIM_PROM).substring(0, 10) : null,
            foto: temFoto
                ? `/api/products/${id}/image?w=400&v=${encodeURIComponent(r.PRD_ULTIMA_ALTERACAO || '')}`
                : null
        };

        if (!secoes.has(secaoId)) secoes.set(secaoId, { id: secaoId, nome: secaoNome, ordem, itens: [] });
        secoes.get(secaoId).itens.push(item);
        if (emPromocao) promocoes.push(item);
    }

    const lista = [...secoes.values()]
        .map((s) => ({ ...s, itens: s.itens.sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR')) }))
        .sort((a, b) => a.ordem - b.ordem || a.nome.localeCompare(b.nome, 'pt-BR'));
    promocoes.sort((a, b) => b.descontoPercentual - a.descontoPercentual || a.nome.localeCompare(b.nome, 'pt-BR'));

    const data = { geradoEm: new Date().toISOString(), totalItens: lista.reduce((n, s) => n + s.itens.length, 0), promocoes, secoes: lista };
    menuCache = { t: Date.now(), data };
    return data;
}

// ---------------------------------------------------------------------------
// Acompanhamento de senha
// ---------------------------------------------------------------------------
async function statusDaSenha(senhaTxt) {
    if (!/^\d{1,6}$/.test(String(senhaTxt))) {
        const e = new Error('Informe apenas os números da sua senha');
        e.status = 400;
        throw e;
    }
    const n = parseInt(senhaTxt, 10);
    const rows = await db.query(
        `SELECT FIRST 1 PEV_ID, PEV_STATUS, PEV_DT_LANCAMENTO, PEV_DT_HR_PRONTO, PEV_DT_HR_ENTREGUE, PEV_QTDE_ITENS
         FROM TB_PEDIDO_VENDA
         WHERE PEV_SENHA = ${n} AND PEV_DT_EMISSAO = CURRENT_DATE
         ORDER BY PEV_ID DESC`);
    if (rows.length === 0) return { encontrado: false, senha: String(n).padStart(2, '0') };

    const p = rows[0];
    const id = parseInt(p.PEV_ID, 10);
    let estado = 'PREPARO';
    if ((p.PEV_STATUS || '') === 'C') estado = 'CANCELADO';
    else if (p.PEV_DT_HR_ENTREGUE) estado = 'ENTREGUE';
    else if (p.PEV_DT_HR_PRONTO) estado = 'PRONTO';

    let aFrente = null;
    if (estado === 'PREPARO') {
        const [r] = await db.query(
            `SELECT COUNT(*) AS N FROM TB_PEDIDO_VENDA
             WHERE PEV_DT_EMISSAO = CURRENT_DATE AND PEV_ID < ${id}
               AND PEV_DT_HR_PRONTO IS NULL AND PEV_DT_HR_ENTREGUE IS NULL AND COALESCE(PEV_STATUS, '') <> 'C'`);
        aFrente = parseInt(r.N, 10) || 0;
    }

    // tempo médio de preparo de hoje (segundos -> minutos)
    const [m] = await db.query(
        `SELECT AVG(DATEDIFF(SECOND FROM PEV_DT_LANCAMENTO TO PEV_DT_HR_PRONTO)) AS S
         FROM TB_PEDIDO_VENDA
         WHERE PEV_DT_EMISSAO = CURRENT_DATE AND PEV_DT_HR_PRONTO IS NOT NULL AND PEV_DT_LANCAMENTO IS NOT NULL
           AND PEV_DT_HR_PRONTO > PEV_DT_LANCAMENTO AND COALESCE(PEV_STATUS, '') <> 'C'`).catch(() => [{ S: null }]);
    const seg = m && m.S !== null ? parseFloat(m.S) : NaN;
    const tempoMedioMin = isFinite(seg) && seg > 0 && seg < 3 * 3600 ? Math.round(seg / 60) : null;

    const lanc = Date.parse(String(p.PEV_DT_LANCAMENTO || '').replace(' ', 'T'));
    return {
        encontrado: true,
        senha: String(n).padStart(2, '0'),
        estado,
        itens: parseInt(p.PEV_QTDE_ITENS, 10) || null,
        aguardandoMin: isFinite(lanc) ? Math.max(0, Math.floor((Date.now() - lanc) / 60000)) : null,
        aFrente,
        tempoMedioMin
    };
}

// ---------------------------------------------------------------------------
// Endereços locais (para montar os QR Codes)
// ---------------------------------------------------------------------------
function enderecosLocais() {
    const out = [];
    const nets = os.networkInterfaces();
    Object.keys(nets).forEach((nome) => {
        (nets[nome] || []).forEach((n) => {
            if (n.family === 'IPv4' && !n.internal) out.push({ interface: nome, ip: n.address });
        });
    });
    const peso = (ip) => (/^192\.168\./.test(ip) ? 0 : /^10\./.test(ip) ? 1 : /^172\.(1[6-9]|2\d|3[01])\./.test(ip) ? 2 : 3);
    return out.sort((a, b) => peso(a.ip) - peso(b.ip));
}

// ---------------------------------------------------------------------------
// App público
// ---------------------------------------------------------------------------
function createPublicApp({ mainApp, getTheme, attachSse, pagesDir }) {
    const app = express();
    app.disable('x-powered-by');

    app.use((req, res, next) => {
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('Referrer-Policy', 'no-referrer');
        if (req.method !== 'GET' && req.method !== 'HEAD') {
            return res.status(405).json({ success: false, error: 'Somente leitura' });
        }
        next();
    });

    // limite simples por IP (visitantes na mesma rede)
    const janela = new Map();
    app.use((req, res, next) => {
        const ip = req.ip || req.socket.remoteAddress || '?';
        const agora = Date.now();
        let b = janela.get(ip);
        if (!b || agora > b.fim) { b = { n: 0, fim: agora + 60000 }; janela.set(ip, b); }
        b.n++;
        if (b.n > 300) return res.status(429).json({ success: false, error: 'Muitas requisições. Aguarde um instante.' });
        if (janela.size > 5000) janela.clear();
        next();
    });

    // ---- páginas ----
    const pagina = (arq) => (req, res) => res.sendFile(path.join(pagesDir, arq));
    app.get('/', (req, res) => res.redirect('/cardapio'));
    app.get('/senha', pagina('senha.html'));
    app.get('/cardapio', pagina('cardapio.html'));

    // ---- dados ----
    app.get('/api/public/info', (req, res) => {
        const t = getTheme();
        res.json({
            success: true,
            data: {
                nome: t.nome || 'DUSUCO',
                subtitulo: t.subtitulo || '',
                corPrimaria: t.corPrimaria || '#FF6B00',
                corSecundaria: t.corSecundaria || '#EA580C',
                modoTema: t.modoTema || 'light',
                logoUrl: '/api/company/logo'
            }
        });
    });

    app.get('/api/public/menu', async (req, res) => {
        try {
            res.setHeader('Cache-Control', 'public, max-age=15');
            res.json({ success: true, data: await buildMenu() });
        } catch (err) {
            res.status(500).json({ success: false, error: 'Cardápio indisponível no momento' });
        }
    });

    app.get('/api/public/senha/:senha', async (req, res) => {
        try {
            res.setHeader('Cache-Control', 'no-store');
            res.json({ success: true, data: await statusDaSenha(req.params.senha) });
        } catch (err) {
            res.status(err.status || 500).json({ success: false, error: err.status ? err.message : 'Consulta indisponível no momento' });
        }
    });

    app.get('/api/public/events', attachSse);

    // ---- somente leitura: imagem do produto e logotipo (reaproveita os manipuladores da API principal) ----
    app.get('/api/products/:id/image', (req, res, next) => {
        if (!/^\d+$/.test(req.params.id)) return res.status(400).end();
        mainApp(req, res, next);
    });
    app.get('/api/company/logo', (req, res, next) => mainApp(req, res, next));

    app.use((req, res) => res.status(404).json({ success: false, error: 'Não encontrado' }));
    return app;
}

module.exports = {
    createPublicApp,
    getCardapioConfig,
    saveCardapioConfig,
    buildMenu,
    statusDaSenha,
    enderecosLocais
};
