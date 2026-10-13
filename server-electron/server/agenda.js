// Agenda de promoções.
//
// O ERP guarda UMA promoção por produto (PRD_VALOR_PROM + datas). Para "deixar pronta a promoção da
// sexta" sem derrubar a que está valendo hoje, a promoção futura entra numa fila (config/promo_agenda.json)
// e é aplicada no dia do início. Quando o produto não tem promoção vigente/futura, a promoção é gravada
// direto no cadastro com as datas (o próprio ERP passa a respeitá-las).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const db = require('./db');

const configDir = process.env.CONFIG_DIR || path.join(__dirname, '..', 'config');
const agendaFile = path.join(configDir, 'promo_agenda.json');
const MAX_TENTATIVAS = 3;

function httpError(status, message, extra) {
    const e = new Error(message);
    e.status = status;
    if (extra) Object.assign(e, extra);
    return e;
}

const two = (n) => String(n).padStart(2, '0');
function hoje() {
    const d = new Date();
    return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`;
}
const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

function parseData(v, obrigatoria, rotulo) {
    if (v === null || v === undefined || v === '') {
        if (obrigatoria) throw httpError(400, `Informe a data de ${rotulo}`);
        return null;
    }
    const m = String(v).match(/^(\d{4})-(\d{2})-(\d{2})(?:$|[T ])/);
    if (!m || +m[2] < 1 || +m[2] > 12 || +m[3] < 1 || +m[3] > 31) throw httpError(400, `Data de ${rotulo} inválida`);
    return `${m[1]}-${m[2]}-${m[3]}`;
}

// Intervalos [ini, fim] com fim opcional (null = sem término)
function sobrepoe(aIni, aFim, bIni, bFim) {
    const ai = aIni || '0000-00-00';
    const bi = bIni || '0000-00-00';
    const af = aFim || '9999-99-99';
    const bf = bFim || '9999-99-99';
    return ai <= bf && bi <= af;
}

// --- persistência (arquivo JSON, gravação atômica) ---
function carregar() {
    try {
        if (fs.existsSync(agendaFile)) {
            const data = JSON.parse(fs.readFileSync(agendaFile, 'utf8'));
            if (Array.isArray(data)) return data;
        }
    } catch (e) {
        console.warn('Erro ao ler promo_agenda.json:', e.message);
    }
    return [];
}

function gravar(lista) {
    // descarta registros finalizados há mais de 60 dias
    const limite = new Date(Date.now() - 60 * 86400000).toISOString();
    const manter = lista.filter((e) => e.status === 'AGENDADA' || (e.atualizadoEm || e.criadoEm) > limite);
    fs.mkdirSync(path.dirname(agendaFile), { recursive: true });
    const tmp = agendaFile + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(manter, null, 2), 'utf8');
    fs.renameSync(tmp, agendaFile);
}

// Serializa alterações (um único processo, mas várias requisições)
let fila = Promise.resolve();
function exclusivo(fn) {
    const run = fila.then(fn);
    fila = run.catch(() => {});
    return run;
}

async function descricoes(ids) {
    const unicos = [...new Set(ids)].filter((n) => Number.isInteger(n));
    if (unicos.length === 0) return {};
    const rows = await db.query(
        `SELECT PRD_ID, PRD_CODIGO, PRD_DESCRICAO, PRD_PRECO_VENDA FROM TB_PRODUTO WHERE PRD_ID IN (${unicos.join(',')})`);
    const out = {};
    rows.forEach((r) => {
        out[parseInt(r.PRD_ID, 10)] = {
            codigo: r.PRD_CODIGO || '',
            descricao: r.PRD_DESCRICAO || '',
            precoVenda: parseFloat(r.PRD_PRECO_VENDA) || 0
        };
    });
    return out;
}

// Lista a agenda (por padrão só as pendentes), com os dados do produto.
async function listar({ incluirFinalizadas = false } = {}) {
    const lista = carregar().filter((e) => incluirFinalizadas || e.status === 'AGENDADA');
    const info = await descricoes(lista.map((e) => e.produtoId));
    return lista
        .map((e) => ({
            ...e,
            codigo: (info[e.produtoId] || {}).codigo || '',
            descricao: (info[e.produtoId] || {}).descricao || `Produto #${e.produtoId}`,
            precoVenda: (info[e.produtoId] || {}).precoVenda || 0,
            descontoPercentual: (info[e.produtoId] || {}).precoVenda > 0
                ? Math.round(((info[e.produtoId].precoVenda - e.precoPromocao) / info[e.produtoId].precoVenda) * 100)
                : 0,
            diasParaInicio: Math.round((Date.parse(e.dtInicio) - Date.parse(hoje())) / 86400000)
        }))
        .sort((a, b) => (a.dtInicio < b.dtInicio ? -1 : a.dtInicio > b.dtInicio ? 1 : 0));
}

function contarPendentes() {
    return carregar().filter((e) => e.status === 'AGENDADA').length;
}

// Cria uma promoção futura. Retorna { modo: 'DIRETO' | 'AGENDADA', ... }.
// Se houver conflito e `forcar` não for true, lança 409 com `detalhes`.
function agendar({ produtoId, percentual, precoPromocao, dtInicio, dtFim, forcar = false }) {
    return exclusivo(async () => {
        const id = parseInt(produtoId, 10);
        if (!Number.isInteger(id) || id <= 0) throw httpError(400, 'Produto inválido');
        const cur = await db.getProductById(id);
        if (!cur) throw httpError(404, 'Produto não encontrado');

        let promo;
        if (precoPromocao !== undefined && precoPromocao !== null && precoPromocao !== '') {
            promo = round2(parseFloat(precoPromocao));
        } else if (percentual !== undefined && percentual !== null && percentual !== '') {
            const p = Number(percentual);
            if (!isFinite(p) || p < 1 || p > 90) throw httpError(400, 'Desconto deve estar entre 1% e 90%');
            promo = round2(cur.precoVenda * (1 - p / 100));
        } else {
            throw httpError(400, 'Informe o desconto (%) ou o preço promocional');
        }
        if (!isFinite(promo) || promo <= 0) throw httpError(400, 'Preço promocional inválido');
        if (!(cur.precoVenda > 0)) throw httpError(400, 'Produto sem preço de venda');
        if (promo >= cur.precoVenda) throw httpError(400, 'O preço promocional deve ser menor que o preço de venda');

        const h = hoje();
        const ini = parseData(dtInicio, true, 'início');
        const fim = parseData(dtFim, false, 'término');
        if (ini < h) throw httpError(400, 'A data de início não pode estar no passado');
        if (fim && fim < ini) throw httpError(400, 'A data de término não pode ser anterior ao início');

        // --- conflitos ---
        const conflitos = [];
        const cIni = cur.dtInicioProm ? String(cur.dtInicioProm).substring(0, 10) : null;
        const cFim = cur.dtFimProm ? String(cur.dtFimProm).substring(0, 10) : null;
        const temPromoAtual = cur.precoPromocao > 0 && !(cFim && cFim < h); // vigente ou futura (não vencida)
        if (temPromoAtual && sobrepoe(cIni, cFim, ini, fim)) {
            conflitos.push({
                tipo: 'PROMOCAO_ATUAL',
                precoPromocao: cur.precoPromocao,
                dtInicio: cIni,
                dtFim: cFim,
                situacao: cIni && cIni > h ? 'FUTURA' : 'ATIVA'
            });
        }
        const lista = carregar();
        const agConflito = lista.filter((e) => e.produtoId === id && e.status === 'AGENDADA' && sobrepoe(e.dtInicio, e.dtFim, ini, fim));
        agConflito.forEach((e) => conflitos.push({
            tipo: 'AGENDADA', id: e.id, precoPromocao: e.precoPromocao, dtInicio: e.dtInicio, dtFim: e.dtFim
        }));

        if (conflitos.length > 0 && !forcar) {
            throw httpError(409, 'Já existe promoção no mesmo período para este produto', {
                codigo: 'CONFLITO',
                detalhes: { produto: { id, descricao: cur.descricao }, conflitos }
            });
        }

        // substitui agendamentos conflitantes
        const agora = new Date().toISOString();
        agConflito.forEach((e) => { e.status = 'SUBSTITUIDA'; e.atualizadoEm = agora; });

        // Grava direto no cadastro quando: começa hoje, ou o produto não tem promoção vigente/futura
        if (ini <= h || !temPromoAtual) {
            await db.updateProductPromotion(id, {
                ativo: true, valorPromocional: promo, dtInicio: ini, dtFim: fim, tipoValor: 'V'
            });
            if (agConflito.length) gravar(lista);
            return { modo: 'DIRETO', produtoId: id, precoPromocao: promo, dtInicio: ini, dtFim: fim, conflitos };
        }

        // Fila: aplicada no dia do início (a promoção atual continua valendo até lá)
        const entrada = {
            id: crypto.randomUUID(),
            produtoId: id,
            precoPromocao: promo,
            dtInicio: ini,
            dtFim: fim,
            status: 'AGENDADA',
            tentativas: 0,
            criadoEm: agora
        };
        lista.push(entrada);
        gravar(lista);
        return { modo: 'AGENDADA', id: entrada.id, produtoId: id, precoPromocao: promo, dtInicio: ini, dtFim: fim, conflitos };
    });
}

function cancelar(agendaId) {
    return exclusivo(async () => {
        const lista = carregar();
        const e = lista.find((x) => x.id === agendaId);
        if (!e) throw httpError(404, 'Agendamento não encontrado');
        if (e.status !== 'AGENDADA') throw httpError(400, 'Este agendamento já foi finalizado');
        e.status = 'CANCELADA';
        e.atualizadoEm = new Date().toISOString();
        gravar(lista);
        return { id: e.id, status: e.status };
    });
}

// Aplica as promoções cujo início chegou. Chamado a cada minuto e na inicialização (recupera atrasos).
function processarVencimentos() {
    return exclusivo(async () => {
        const lista = carregar();
        const h = hoje();
        let aplicadas = 0;
        let falhas = 0;
        let alterou = false;

        for (const e of lista) {
            if (e.status !== 'AGENDADA' || e.dtInicio > h) continue;
            e.atualizadoEm = new Date().toISOString();
            alterou = true;

            if (e.dtFim && e.dtFim < h) { e.status = 'EXPIRADA'; continue; }

            try {
                const cur = await db.getProductById(e.produtoId);
                if (!cur) throw new Error('Produto não encontrado');
                if (!(cur.precoVenda > 0) || e.precoPromocao >= cur.precoVenda) {
                    throw new Error('Preço de venda mudou: promoção ficaria igual ou maior que o preço');
                }
                await db.updateProductPromotion(e.produtoId, {
                    ativo: true, valorPromocional: e.precoPromocao, dtInicio: e.dtInicio, dtFim: e.dtFim, tipoValor: 'V'
                });
                e.status = 'APLICADA';
                e.aplicadaEm = new Date().toISOString();
                aplicadas++;
            } catch (err) {
                e.tentativas = (e.tentativas || 0) + 1;
                e.erro = err.message;
                if (e.tentativas >= MAX_TENTATIVAS) e.status = 'FALHOU';
                falhas++;
            }
        }
        if (alterou) gravar(lista);
        return { aplicadas, falhas };
    });
}

module.exports = { listar, agendar, cancelar, processarVencimentos, contarPendentes };
