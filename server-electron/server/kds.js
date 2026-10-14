// KDS (tela da cozinha) por estação.
//
// Cada item do pedido é encaminhado a uma estação por regra (prioridade): produto > grupo > setor do ERP
// (TB_SETOR / PRD_SETOR) > estação padrão. O ERP só guarda "pronto" por pedido, então a conclusão por
// estação fica em kds_state.json; quando TODAS as estações envolvidas concluem, o pedido vira PRONTO.
const fs = require('fs');
const path = require('path');
const db = require('./db');

const configDir = process.env.CONFIG_DIR || path.join(__dirname, '..', 'config');
const configFile = path.join(configDir, 'kds.json');
const stateFile = path.join(configDir, 'kds_state.json');

function httpError(status, message) {
    const e = new Error(message);
    e.status = status;
    return e;
}

function lerJson(file, padrao) {
    try {
        if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (e) {
        console.warn(`Erro ao ler ${path.basename(file)}:`, e.message);
    }
    return padrao;
}
function gravarJson(file, data) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
    fs.renameSync(tmp, file);
}

// --- opcoes disponiveis (setores e grupos do ERP) ---
async function opcoes() {
    const [setores, grupos] = await Promise.all([
        db.query('SELECT SET_ID AS ID, SET_DESCRICAO AS NOME FROM TB_SETOR ORDER BY SET_ID'),
        db.query(`SELECT PGRU_ID AS ID, PGRU_DESCRICAO AS NOME FROM TB_PROD_GRUPO
                  WHERE PGRU_ID IN (SELECT DISTINCT PRD_GRUPO FROM TB_PRODUTO
                                    WHERE PRD_TIPO_PRODUTO IN ('N','P','T') AND PRD_STATUS IN ('A','P') AND PRD_GRUPO IS NOT NULL)
                  ORDER BY PGRU_DESCRICAO`)
    ]);
    return {
        setores: setores.map((s) => ({ id: parseInt(s.ID, 10), nome: s.NOME })),
        grupos: grupos.map((g) => ({ id: parseInt(g.ID, 10), nome: g.NOME }))
    };
}

// --- configuracao das estacoes ---
async function configuracaoPadrao() {
    const op = await opcoes().catch(() => ({ setores: [] }));
    const estacoes = op.setores.map((s) => ({
        id: `setor${s.id}`,
        nome: s.nome.charAt(0) + s.nome.slice(1).toLowerCase(),
        setores: [s.id],
        grupos: [],
        produtos: [],
        padrao: false
    }));
    estacoes.push({ id: 'bebidas', nome: 'Bebidas e outros', setores: [], grupos: [], produtos: [], padrao: true });
    return { estacoes };
}

async function getConfig() {
    const salvo = lerJson(configFile, null);
    if (salvo && Array.isArray(salvo.estacoes) && salvo.estacoes.length) return salvo;
    return configuracaoPadrao();
}

function validarConfig(cfg) {
    if (!cfg || !Array.isArray(cfg.estacoes) || cfg.estacoes.length === 0) throw httpError(400, 'Informe ao menos uma estação');
    if (cfg.estacoes.length > 12) throw httpError(400, 'Máximo de 12 estações');
    const ids = new Set();
    let padroes = 0;
    const out = cfg.estacoes.map((e, i) => {
        const nome = String(e.nome || '').trim().substring(0, 30);
        if (!nome) throw httpError(400, `A estação ${i + 1} precisa de um nome`);
        let id = String(e.id || '').toLowerCase().replace(/[^a-z0-9_-]/g, '').substring(0, 30);
        if (!id) id = `est${i + 1}`;
        if (ids.has(id)) throw httpError(400, `Estação repetida: ${id}`);
        ids.add(id);
        const lista = (v) => (Array.isArray(v) ? [...new Set(v.map((n) => parseInt(n, 10)).filter((n) => Number.isInteger(n)))] : []);
        const padrao = e.padrao === true;
        if (padrao) padroes++;
        return { id, nome, setores: lista(e.setores), grupos: lista(e.grupos), produtos: lista(e.produtos), padrao };
    });
    if (padroes !== 1) throw httpError(400, 'Marque exatamente uma estação como padrão (recebe o que não casar com nenhuma regra)');
    return { estacoes: out };
}

async function salvarConfig(cfg) {
    const valida = validarConfig(cfg);
    gravarJson(configFile, valida);
    return valida;
}

// --- estado de conclusao por estacao ---
function lerEstado() {
    const s = lerJson(stateFile, {});
    return s && typeof s === 'object' ? s : {};
}
function gravarEstado(s) {
    // descarta pedidos com mais de 3 dias
    const limite = Date.now() - 3 * 86400000;
    Object.keys(s).forEach((id) => {
        const t = Object.values(s[id] || {}).map((v) => Date.parse(v)).filter((n) => isFinite(n));
        if (t.length && Math.max(...t) < limite) delete s[id];
    });
    gravarJson(stateFile, s);
}

let fila = Promise.resolve();
function exclusivo(fn) {
    const run = fila.then(fn);
    fila = run.catch(() => {});
    return run;
}

// --- roteamento item -> estacao ---
function estacaoDoItem(cfg, prod) {
    const e = cfg.estacoes;
    if (prod) {
        const porProduto = e.find((x) => x.produtos.includes(prod.id));
        if (porProduto) return porProduto.id;
        if (prod.grupo !== null) {
            const porGrupo = e.find((x) => x.grupos.includes(prod.grupo));
            if (porGrupo) return porGrupo.id;
        }
        if (prod.setor !== null) {
            const porSetor = e.find((x) => x.setores.includes(prod.setor));
            if (porSetor) return porSetor.id;
        }
    }
    return (e.find((x) => x.padrao) || e[0]).id;
}

async function carregarPedidos(cfg) {
    const pedidos = await db.getOrders({ filter: 'PREPARO', limit: 150 });
    if (pedidos.length === 0) return [];

    const ids = pedidos.map((p) => p.id);
    const prodIds = [...new Set(pedidos.flatMap((p) => p.itens.map((i) => parseInt(i.produtoId, 10))).filter((n) => Number.isInteger(n) && n > 0))];

    const [prods, extras] = await Promise.all([
        prodIds.length
            ? db.query(`SELECT PRD_ID AS ID, PRD_GRUPO AS G, PRD_SETOR AS S FROM TB_PRODUTO WHERE PRD_ID IN (${prodIds.join(',')})`)
            : [],
        db.query(
            `SELECT PEVI_PEDIDO_VENDA AS PED, PEVI_SEQUENCIA AS SEQ, PEVI_DT_LANCAMENTO AS QUANDO, PEVI_OBSERVACAO AS OBS
             FROM TB_PEDIDO_VENDA_ITEM WHERE PEVI_PEDIDO_VENDA IN (${ids.join(',')})`).catch(() => [])
    ]);

    const infoProd = {};
    prods.forEach((r) => {
        const g = parseInt(r.G, 10);
        const s = parseInt(r.S, 10);
        infoProd[parseInt(r.ID, 10)] = { id: parseInt(r.ID, 10), grupo: Number.isInteger(g) ? g : null, setor: Number.isInteger(s) ? s : null };
    });
    const extraItem = {};
    extras.forEach((r) => { extraItem[`${r.PED}:${r.SEQ}`] = { quando: r.QUANDO, obs: r.OBS || '' }; });

    return pedidos.map((p) => ({
        id: p.id,
        senha: p.senha,
        cliente: p.clienteNome,
        comanda: p.comanda,
        mesa: p.mesa,
        lancamento: p.dataLancamento,
        itens: p.itens.map((it) => {
            const prod = infoProd[parseInt(it.produtoId, 10)] || null;
            const ex = extraItem[`${p.id}:${it.sequencia}`] || {};
            return {
                sequencia: it.sequencia,
                produtoId: parseInt(it.produtoId, 10) || 0,
                descricao: it.descricao,
                quantidade: it.quantidade,
                observacao: ex.obs || '',
                lancadoEm: ex.quando || p.dataLancamento,
                estacao: estacaoDoItem(cfg, prod)
            };
        })
    }));
}

const minutosDesde = (ts) => {
    const t = Date.parse(String(ts || '').replace(' ', 'T'));
    return isFinite(t) ? Math.max(0, Math.floor((Date.now() - t) / 60000)) : 0;
};

// Pedidos pendentes para uma estacao (ou todas) + itens agrupados.
async function pedidosDaEstacao(estacaoId) {
    const cfg = await getConfig();
    if (estacaoId && !cfg.estacoes.some((e) => e.id === estacaoId)) throw httpError(404, 'Estação não encontrada');

    const estado = lerEstado();
    const pedidos = await carregarPedidos(cfg);
    const lista = [];
    const agrupado = {};

    for (const p of pedidos) {
        const envolvidas = [...new Set(p.itens.map((i) => i.estacao))];
        const concluidas = envolvidas.filter((e) => estado[p.id] && estado[p.id][e]);
        const pendentesPedido = envolvidas.filter((e) => !concluidas.includes(e));

        const alvo = estacaoId ? [estacaoId] : pendentesPedido;
        const itensVisiveis = p.itens.filter((i) => alvo.includes(i.estacao) && !(estado[p.id] && estado[p.id][i.estacao]));
        if (itensVisiveis.length === 0) continue;

        lista.push({
            id: p.id,
            senha: p.senha,
            cliente: p.cliente,
            comanda: p.comanda,
            mesa: p.mesa,
            lancamento: p.lancamento,
            minutos: minutosDesde(p.lancamento),
            estacoesEnvolvidas: envolvidas,
            estacoesConcluidas: concluidas,
            itens: itensVisiveis.map((i) => ({
                descricao: i.descricao,
                quantidade: i.quantidade,
                observacao: i.observacao,
                estacao: i.estacao,
                minutos: minutosDesde(i.lancadoEm)
            }))
        });

        itensVisiveis.forEach((i) => {
            const chave = `${i.produtoId}|${i.descricao}`;
            const g = agrupado[chave] || (agrupado[chave] = { produtoId: i.produtoId, descricao: i.descricao, quantidade: 0, pedidos: [], maisAntigoMin: 0 });
            g.quantidade += i.quantidade;
            if (!g.pedidos.includes(p.senha)) g.pedidos.push(p.senha);
            g.maisAntigoMin = Math.max(g.maisAntigoMin, minutosDesde(i.lancadoEm));
        });
    }

    lista.sort((a, b) => b.minutos - a.minutos); // mais antigos primeiro
    const grupos = Object.values(agrupado).sort((a, b) => b.quantidade - a.quantidade || a.descricao.localeCompare(b.descricao));
    return {
        estacao: estacaoId || null,
        estacoes: cfg.estacoes.map((e) => ({ id: e.id, nome: e.nome })),
        pedidos: lista,
        agrupado: grupos,
        geradoEm: new Date().toISOString()
    };
}

// Marca (ou desfaz) a conclusao de uma estacao num pedido; se todas concluirem, o pedido fica PRONTO no ERP.
function concluir(pedidoId, estacaoId, { desfazer = false } = {}) {
    return exclusivo(async () => {
        const id = parseInt(pedidoId, 10);
        if (!Number.isInteger(id) || id <= 0) throw httpError(400, 'Pedido inválido');
        const cfg = await getConfig();
        if (!cfg.estacoes.some((e) => e.id === estacaoId)) throw httpError(404, 'Estação não encontrada');

        const pedidos = await carregarPedidos(cfg);
        const pedido = pedidos.find((p) => p.id === id);
        if (!pedido) throw httpError(404, 'Pedido não está em preparo');
        const envolvidas = [...new Set(pedido.itens.map((i) => i.estacao))];
        if (!envolvidas.includes(estacaoId)) throw httpError(400, 'Esta estação não tem itens neste pedido');

        const estado = lerEstado();
        estado[id] = estado[id] || {};
        if (desfazer) delete estado[id][estacaoId];
        else estado[id][estacaoId] = new Date().toISOString();
        gravarEstado(estado);

        const faltam = envolvidas.filter((e) => !estado[id][e]);
        let pronto = false;
        if (!desfazer && faltam.length === 0) {
            await db.updateOrderStatus(id, 'PRONTO');
            pronto = true;
        }
        return { pedido: id, estacao: estacaoId, concluidas: envolvidas.filter((e) => estado[id][e]), faltam, pedidoPronto: pronto };
    });
}

module.exports = { getConfig, salvarConfig, opcoes, pedidosDaEstacao, concluir, validarConfig };
