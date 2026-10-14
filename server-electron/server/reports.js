// Relatórios gerenciais: dashboard de vendas e "o que mudou hoje".
//
// Convenções do ERP (verificadas no banco): PEV_STATUS 'F' = venda finalizada, 'C' = cancelada,
// 'A' = em aberto. Só 'F' entra no faturamento. O horário do pedido é PEV_DT_LANCAMENTO.
const db = require('./db');
const avaliacoes = require('./avaliacoes');

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const pad = (n) => String(n).padStart(2, '0');

function httpError(status, message) {
    const e = new Error(message);
    e.status = status;
    return e;
}
function fmt(d) {
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function parse(ymd) {
    return new Date(`${ymd}T00:00:00`);
}
function addDays(ymd, n) {
    const d = parse(ymd);
    d.setDate(d.getDate() + n);
    return fmt(d);
}
function diffDays(a, b) {
    return Math.round((parse(b) - parse(a)) / 86400000);
}
function hoje() {
    return fmt(new Date());
}
function dataValida(v, rotulo) {
    if (typeof v !== 'string' || !YMD.test(v) || isNaN(parse(v).getTime())) throw httpError(400, `${rotulo} inválida (use AAAA-MM-DD)`);
    return v;
}
const num = (v) => {
    const n = parseFloat(v);
    return isFinite(n) ? n : 0;
};
const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
const pct = (atual, anterior) => (anterior > 0 ? round2(((atual - anterior) / anterior) * 100) : null);

async function resumo(ini, fim) {
    const [r] = await db.query(
        `SELECT COUNT(*) AS N, COALESCE(SUM(PEV_VALOR_TOTAL), 0) AS V
         FROM TB_PEDIDO_VENDA
         WHERE PEV_STATUS = 'F' AND PEV_DT_EMISSAO >= '${ini}' AND PEV_DT_EMISSAO <= '${fim}'`);
    const pedidos = parseInt(r.N, 10) || 0;
    const faturamento = round2(num(r.V));
    return { pedidos, faturamento, ticketMedio: pedidos > 0 ? round2(faturamento / pedidos) : 0 };
}

async function porDia(ini, fim) {
    const rows = await db.query(
        `SELECT PEV_DT_EMISSAO AS D, COUNT(*) AS N, COALESCE(SUM(PEV_VALOR_TOTAL), 0) AS V
         FROM TB_PEDIDO_VENDA
         WHERE PEV_STATUS = 'F' AND PEV_DT_EMISSAO >= '${ini}' AND PEV_DT_EMISSAO <= '${fim}'
         GROUP BY PEV_DT_EMISSAO`);
    const mapa = {};
    rows.forEach((r) => { mapa[String(r.D).substring(0, 10)] = { pedidos: parseInt(r.N, 10) || 0, faturamento: round2(num(r.V)) }; });
    const dias = diffDays(ini, fim) + 1;
    const out = [];
    for (let i = 0; i < dias; i++) {
        const d = addDays(ini, i);
        const m = mapa[d] || { pedidos: 0, faturamento: 0 };
        out.push({ data: d, diaSemana: parse(d).getDay(), pedidos: m.pedidos, faturamento: m.faturamento });
    }
    return out;
}

// Dashboard de vendas para o intervalo [inicio, fim] (datas inclusivas) com comparativo.
// comparar: 'ANTERIOR' (período imediatamente anterior, mesmo tamanho) | 'SEMANA' (7 dias antes) | 'NENHUM'
async function dashboard({ inicio, fim, comparar = 'ANTERIOR' } = {}) {
    const h = hoje();
    fim = dataValida(fim || h, 'Data final');
    inicio = dataValida(inicio || addDays(fim, -6), 'Data inicial');
    if (inicio > fim) throw httpError(400, 'A data inicial não pode ser posterior à final');
    const dias = diffDays(inicio, fim) + 1;
    if (dias > 400) throw httpError(400, 'Período máximo: 400 dias');

    // período de comparação
    let antIni = null;
    let antFim = null;
    if (comparar === 'SEMANA') {
        antIni = addDays(inicio, -7);
        antFim = addDays(fim, -7);
    } else if (comparar !== 'NENHUM') {
        antFim = addDays(inicio, -1);
        antIni = addDays(antFim, -(dias - 1));
    }

    const [atual, diaria, horas, semana, topQtd, topFat, ultima] = await Promise.all([
        resumo(inicio, fim),
        porDia(inicio, fim),
        db.query(
            `SELECT EXTRACT(HOUR FROM PEV_DT_LANCAMENTO) AS H, COUNT(*) AS N, COALESCE(SUM(PEV_VALOR_TOTAL), 0) AS V
             FROM TB_PEDIDO_VENDA
             WHERE PEV_STATUS = 'F' AND PEV_DT_EMISSAO >= '${inicio}' AND PEV_DT_EMISSAO <= '${fim}'
             GROUP BY 1`),
        db.query(
            `SELECT EXTRACT(WEEKDAY FROM PEV_DT_EMISSAO) AS W, COUNT(*) AS N, COALESCE(SUM(PEV_VALOR_TOTAL), 0) AS V
             FROM TB_PEDIDO_VENDA
             WHERE PEV_STATUS = 'F' AND PEV_DT_EMISSAO >= '${inicio}' AND PEV_DT_EMISSAO <= '${fim}'
             GROUP BY 1`),
        db.query(
            `SELECT FIRST 10 I.PEVI_PRODUTO AS ID, MAX(I.PEVI_DESCRICAO) AS DESCR,
                    SUM(I.PEVI_QUANTIDADE) AS Q, COALESCE(SUM(I.PEVI_VALOR_TOTAL), 0) AS V
             FROM TB_PEDIDO_VENDA_ITEM I
             JOIN TB_PEDIDO_VENDA P ON (P.PEV_EMPRESA = I.PEVI_EMPRESA AND P.PEV_ID = I.PEVI_PEDIDO_VENDA)
             WHERE P.PEV_STATUS = 'F' AND P.PEV_DT_EMISSAO >= '${inicio}' AND P.PEV_DT_EMISSAO <= '${fim}'
             GROUP BY I.PEVI_PRODUTO
             ORDER BY 3 DESC`),
        db.query(
            `SELECT FIRST 10 I.PEVI_PRODUTO AS ID, MAX(I.PEVI_DESCRICAO) AS DESCR,
                    SUM(I.PEVI_QUANTIDADE) AS Q, COALESCE(SUM(I.PEVI_VALOR_TOTAL), 0) AS V
             FROM TB_PEDIDO_VENDA_ITEM I
             JOIN TB_PEDIDO_VENDA P ON (P.PEV_EMPRESA = I.PEVI_EMPRESA AND P.PEV_ID = I.PEVI_PEDIDO_VENDA)
             WHERE P.PEV_STATUS = 'F' AND P.PEV_DT_EMISSAO >= '${inicio}' AND P.PEV_DT_EMISSAO <= '${fim}'
             GROUP BY I.PEVI_PRODUTO
             ORDER BY 4 DESC`),
        db.query(`SELECT MAX(PEV_DT_EMISSAO) AS D FROM TB_PEDIDO_VENDA WHERE PEV_STATUS = 'F'`)
    ]);

    const itemTop = (r) => ({
        produtoId: parseInt(r.ID, 10) || 0,
        descricao: r.DESCR || `Produto #${r.ID}`,
        quantidade: round2(num(r.Q)),
        faturamento: round2(num(r.V))
    });

    // horários de pico (0..23, só com horas que tiveram venda no intervalo útil)
    const porHora = [];
    for (let hr = 0; hr < 24; hr++) {
        const r = horas.find((x) => parseInt(x.H, 10) === hr);
        porHora.push({ hora: hr, pedidos: r ? parseInt(r.N, 10) : 0, faturamento: r ? round2(num(r.V)) : 0 });
    }
    const pico = porHora.reduce((m, x) => (x.pedidos > m.pedidos ? x : m), { hora: null, pedidos: 0, faturamento: 0 });

    // dia da semana (0 = domingo): total e média por ocorrência no período
    const nomes = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
    const ocorrencias = [0, 0, 0, 0, 0, 0, 0];
    diaria.forEach((d) => { ocorrencias[d.diaSemana]++; });
    const porDiaSemana = nomes.map((nome, i) => {
        const r = semana.find((x) => parseInt(x.W, 10) === i);
        const pedidos = r ? parseInt(r.N, 10) : 0;
        const faturamento = r ? round2(num(r.V)) : 0;
        return {
            dia: i, nome, pedidos, faturamento,
            mediaPedidos: ocorrencias[i] ? round2(pedidos / ocorrencias[i]) : 0,
            mediaFaturamento: ocorrencias[i] ? round2(faturamento / ocorrencias[i]) : 0
        };
    });

    const melhorDia = diaria.reduce((m, d) => (d.faturamento > m.faturamento ? d : m), { data: null, faturamento: 0, pedidos: 0 });

    let anterior = null;
    let variacao = null;
    let diariaAnterior = null;
    if (antIni) {
        const [res, dia] = await Promise.all([resumo(antIni, antFim), porDia(antIni, antFim)]);
        anterior = { inicio: antIni, fim: antFim, ...res };
        diariaAnterior = dia;
        variacao = {
            pedidos: pct(atual.pedidos, res.pedidos),
            faturamento: pct(atual.faturamento, res.faturamento),
            ticketMedio: pct(atual.ticketMedio, res.ticketMedio)
        };
    }

    return {
        periodo: { inicio, fim, dias },
        comparacao: comparar,
        atual,
        anterior,
        variacao,
        porDia: diaria,
        porDiaAnterior: diariaAnterior,
        porHora,
        picoHora: pico.hora === null ? null : { hora: pico.hora, pedidos: pico.pedidos },
        porDiaSemana,
        melhorDia: melhorDia.data ? { data: melhorDia.data, faturamento: melhorDia.faturamento, pedidos: melhorDia.pedidos } : null,
        topQuantidade: topQtd.map(itemTop),
        topFaturamento: topFat.map(itemTop),
        ultimaVenda: ultima[0] && ultima[0].D ? String(ultima[0].D).substring(0, 10) : null,
        avaliacoes: avaliacoes.resumo(inicio, fim)
    };
}

// ---------------------------------------------------------------------------
// "O que mudou hoje": auditoria (ERP e este sistema) + movimentos de estoque + alterações sem detalhe
// ---------------------------------------------------------------------------
const CAMPO_TIPO = {
    PRD_PRECO_VENDA: 'PRECO', PRD_PRECO_MINIMO: 'PRECO', PRD_PRECO_COMPRA: 'PRECO',
    PRD_VALOR_PROM: 'PROMOCAO', PRD_DT_INI_PROM: 'PROMOCAO', PRD_DT_FIM_PROM: 'PROMOCAO', PRD_TIPO_VALOR_PROM: 'PROMOCAO',
    PRDE_ESTOQUE: 'ESTOQUE', PRDE_ESTOQUE_NF: 'ESTOQUE',
    PRD_STATUS: 'STATUS',
    PRD_FOTO: 'FOTO', PRD_IMAGEM: 'FOTO'
};
const ROTULO_CAMPO = {
    PRD_PRECO_VENDA: 'Preço de venda', PRD_PRECO_MINIMO: 'Preço mínimo', PRD_PRECO_COMPRA: 'Preço de compra',
    PRD_VALOR_PROM: 'Preço promocional', PRD_DT_INI_PROM: 'Início da promoção', PRD_DT_FIM_PROM: 'Fim da promoção',
    PRD_TIPO_VALOR_PROM: 'Tipo da promoção', PRDE_ESTOQUE: 'Estoque', PRDE_ESTOQUE_NF: 'Estoque fiscal',
    PRD_STATUS: 'Status', PRD_FOTO: 'Foto', PRD_IMAGEM: 'Foto', PRD_DESCRICAO: 'Descrição',
    PRD_UN_VENDA: 'Unidade', PRD_REFERENCIA: 'Referência', PRD_OBSERVACAO: 'Observação'
};

function hora(ts) {
    const m = String(ts || '').match(/(\d{2}):(\d{2})/);
    return m ? `${m[1]}:${m[2]}` : '';
}
function statusLegivel(v) {
    return { A: 'Ativo', I: 'Inativo', P: 'Ativo (P)' }[v] || v;
}

async function mudancas({ data } = {}) {
    const dia = dataValida(data || hoje(), 'Data');
    const prox = addDays(dia, 1);

    const [auditoria, movimentos, alterados, usuarios] = await Promise.all([
        db.query(
            `SELECT FIRST 1500 A.AUD_SEQUENCIA AS SEQ, A.AUD_TABELA AS TAB, A.AUD_ID_REGISTRO AS PRD, A.AUD_DT_LANCAMENTO AS QUANDO,
                    A.AUD_USUARIO AS USU, A.AUD_VERSAO AS VERSAO, A.AUD_DESC_REGISTRO AS DESCR,
                    I.AUDI_CAMPO AS CAMPO, I.AUDI_CAMPO_DESC AS CAMPO_DESC, I.AUDI_VALOR_ANTIGO AS ANTIGO, I.AUDI_VALOR_NOVO AS NOVO
             FROM TB_AUDITORIA A
             JOIN TB_AUDITORIA_ITEM I ON (I.AUDI_EMPRESA = A.AUD_EMPRESA AND I.AUDI_TABELA = A.AUD_TABELA
                                          AND I.AUDI_ID_REGISTRO = A.AUD_ID_REGISTRO AND I.AUDI_AUDITORIA = A.AUD_SEQUENCIA)
             WHERE A.AUD_TABELA IN ('TB_PRODUTO', 'TB_PRODUTO_ESTOQUE')
               AND A.AUD_DT_LANCAMENTO >= '${dia}' AND A.AUD_DT_LANCAMENTO < '${prox}'
             ORDER BY A.AUD_SEQUENCIA DESC`),
        db.query(
            `SELECT FIRST 800 M.PRDM_ID AS ID, M.PRDM_PRODUTO AS PRD, M.PRDM_TIPO AS TIPO, M.PRDM_QUANTIDADE AS QTD,
                    M.PRDM_ORIGEM_MOVIMENTO AS ORIGEM, M.PRDM_HISTORICO AS HIST, M.PRDM_DT_LANCAMENTO AS QUANDO,
                    M.PRDM_USUARIO AS USU, P.PRD_DESCRICAO AS DESCR
             FROM TB_PRODUTO_MOVIMENTO M
             LEFT JOIN TB_PRODUTO P ON (P.PRD_ID = M.PRDM_PRODUTO)
             WHERE M.PRDM_DT_MOVIMENTO = '${dia}' AND M.PRDM_ORIGEM_MOVIMENTO <> 'VENDA'
             ORDER BY M.PRDM_ID DESC`),
        db.query(
            `SELECT FIRST 500 PRD_ID AS ID, PRD_DESCRICAO AS DESCR, PRD_ULTIMA_ALTERACAO AS QUANDO
             FROM TB_PRODUTO
             WHERE PRD_ULTIMA_ALTERACAO >= '${dia}' AND PRD_ULTIMA_ALTERACAO < '${prox}'
             ORDER BY PRD_ULTIMA_ALTERACAO DESC`),
        db.query('SELECT USU_ID AS ID, USU_NOME AS NOME FROM TB_USUARIO')
    ]);

    const nomeUsuario = {};
    usuarios.forEach((u) => { nomeUsuario[u.ID] = u.NOME || `Usuário ${u.ID}`; });
    const quem = (id) => (id ? nomeUsuario[id] || `Usuário ${id}` : '');

    const itens = [];
    const comDetalhe = new Set();

    // 1) auditoria
    const ids = [...new Set(auditoria.map((r) => parseInt(r.PRD, 10)).filter((n) => Number.isInteger(n)))];
    const descr = {};
    if (ids.length) {
        const rows = await db.query(`SELECT PRD_ID AS ID, PRD_DESCRICAO AS DESCR FROM TB_PRODUTO WHERE PRD_ID IN (${ids.join(',')})`);
        rows.forEach((r) => { descr[parseInt(r.ID, 10)] = r.DESCR; });
    }
    auditoria.forEach((r) => {
        if (r.CAMPO === 'PRD_ULTIMA_ALTERACAO') return; // ruído: toda gravação toca este campo
        const pid = parseInt(r.PRD, 10);
        comDetalhe.add(pid);
        const tipo = CAMPO_TIPO[r.CAMPO] || 'CADASTRO';
        let de = r.ANTIGO || '';
        let para = r.NOVO || '';
        if (r.CAMPO === 'PRD_STATUS') { de = statusLegivel(de); para = statusLegivel(para); }
        itens.push({
            hora: hora(r.QUANDO),
            quando: r.QUANDO,
            tipo,
            produtoId: pid,
            produto: descr[pid] || r.DESCR || `Produto #${pid}`,
            campo: ROTULO_CAMPO[r.CAMPO] || r.CAMPO_DESC || r.CAMPO,
            de,
            para,
            usuario: quem(r.USU),
            origem: /upweb/i.test(r.VERSAO || '') ? 'Este sistema' : 'ERP'
        });
    });

    // 2) movimentos de estoque que não são venda
    movimentos.forEach((m) => {
        const pid = parseInt(m.PRD, 10);
        comDetalhe.add(pid);
        const saida = /^SAI/i.test(m.TIPO || '');
        const qtd = round2(num(m.QTD));
        itens.push({
            hora: hora(m.QUANDO),
            quando: m.QUANDO,
            tipo: 'ESTOQUE',
            produtoId: pid,
            produto: m.DESCR || `Produto #${pid}`,
            campo: `Movimento de estoque (${m.ORIGEM || 'outros'})`,
            de: '',
            para: `${saida ? '-' : '+'}${qtd}`,
            detalhe: m.HIST || '',
            usuario: quem(m.USU),
            origem: /upweb/i.test(m.ORIGEM || '') ? 'Este sistema' : 'ERP'
        });
    });

    // 3) alterados hoje sem registro detalhado (ex.: edição que não passou pela auditoria)
    alterados.forEach((p) => {
        const pid = parseInt(p.ID, 10);
        if (comDetalhe.has(pid)) return;
        itens.push({
            hora: hora(p.QUANDO),
            quando: p.QUANDO,
            tipo: 'ALTERADO',
            produtoId: pid,
            produto: p.DESCR || `Produto #${pid}`,
            campo: 'Cadastro alterado (sem detalhe na auditoria)',
            de: '',
            para: '',
            usuario: '',
            origem: 'ERP'
        });
    });

    itens.sort((a, b) => String(b.quando).localeCompare(String(a.quando)));

    const resumoTipos = {};
    itens.forEach((i) => { resumoTipos[i.tipo] = (resumoTipos[i.tipo] || 0) + 1; });
    const produtos = new Set(itens.map((i) => i.produtoId));

    return {
        data: dia,
        total: itens.length,
        produtosAfetados: produtos.size,
        porTipo: resumoTipos,
        itens
    };
}

module.exports = { dashboard, mudancas };
