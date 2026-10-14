// Área pública (clientes): acompanhamento de senha e cardápio digital.
//
// Roda numa PORTA SEPARADA (padrão 8083) que expõe apenas rotas de LEITURA e dados mínimos. Assim a rede
// de visitantes pode alcançar a porta 8083 sem alcançar a API administrativa (8080), que altera preços e estoque.
const express = require('express');
const fs = require('fs');
const path = require('path');
const os = require('os');
const db = require('./db');
const cupons = require('./cupons');
const avaliacoes = require('./avaliacoes');
const whatsapp = require('./whatsapp');

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
    pedidoOnline: false,       // permite o cliente enviar o pedido pelo cardápio (gera senha e cai no KDS)
    destaqueTitulo: 'Prato do dia', // titulo da secao de destaque diario
    destaques: {},             // { '0'..'6' (dia da semana, 0 = domingo): [ids de produto] }
    mostrarMaisPedidos: true,  // secao "Mais pedidos agora" (calculada das vendas)
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

function normalizarDestaques(v) {
    const out = {};
    for (let d = 0; d <= 6; d++) {
        const lista = v && Array.isArray(v[String(d)]) ? v[String(d)] : [];
        const ids = [...new Set(lista.map((n) => parseInt(n, 10)).filter((n) => Number.isInteger(n) && n > 0))].slice(0, 12);
        if (ids.length) out[String(d)] = ids;
    }
    return out;
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
        pedidoOnline: bool('pedidoOnline'),
        mostrarMaisPedidos: bool('mostrarMaisPedidos'),
        destaqueTitulo: e.destaqueTitulo === undefined ? atual.destaqueTitulo
            : (String(e.destaqueTitulo).replace(/[\u0000-\u001f<>]/g, '').trim().substring(0, 40) || 'Prato do dia'),
        destaques: e.destaques === undefined ? atual.destaques : normalizarDestaques(e.destaques),
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

// Produtos mais pedidos "agora": ultimas 3 h; se poucos, o dia; se poucos, a ultima semana de movimento.
let maisCache = null;
async function maisPedidosIds() {
    if (maisCache && Date.now() - maisCache.t < 60000) return maisCache.data;
    const base = `SELECT FIRST 8 I.PEVI_PRODUTO AS ID, SUM(I.PEVI_QUANTIDADE) AS Q
        FROM TB_PEDIDO_VENDA_ITEM I
        JOIN TB_PEDIDO_VENDA P ON (P.PEV_EMPRESA = I.PEVI_EMPRESA AND P.PEV_ID = I.PEVI_PEDIDO_VENDA)
        WHERE COALESCE(P.PEV_STATUS, '') <> 'C' AND `;
    const fim = ` GROUP BY I.PEVI_PRODUTO ORDER BY 2 DESC`;
    const niveis = [
        { titulo: 'Mais pedidos agora', cond: `P.PEV_DT_EMISSAO = CURRENT_DATE AND P.PEV_DT_LANCAMENTO >= DATEADD(-3 HOUR TO CURRENT_TIMESTAMP)` },
        { titulo: 'Mais pedidos de hoje', cond: `P.PEV_DT_EMISSAO = CURRENT_DATE` },
        { titulo: 'Mais pedidos da semana',
          cond: `P.PEV_DT_EMISSAO >= DATEADD(-7 DAY TO (SELECT MAX(PEV_DT_EMISSAO) FROM TB_PEDIDO_VENDA WHERE PEV_STATUS = 'F'))` }
    ];
    let resultado = { titulo: '', ids: [] };
    for (let n = 0; n < niveis.length; n++) {
        let rows = [];
        try { rows = await db.query(base + niveis[n].cond + fim); } catch (e) { rows = []; }
        const ids = rows.map((r) => parseInt(r.ID, 10)).filter((x) => Number.isInteger(x));
        if (ids.length >= 3 || (n === niveis.length - 1 && ids.length > 0)) { resultado = { titulo: niveis[n].titulo, ids }; break; }
    }
    maisCache = { t: Date.now(), data: resultado };
    return resultado;
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

    // destaques do dia da semana e "mais pedidos agora" (so itens que estao no cardapio)
    const porId = new Map();
    lista.forEach((s) => s.itens.forEach((i) => { if (!porId.has(i.id)) porId.set(i.id, i); }));
    const idsDia = (cfg.destaques && cfg.destaques[String(new Date().getDay())]) || [];
    const destaques = { titulo: cfg.destaqueTitulo || 'Prato do dia', itens: idsDia.map((id) => porId.get(id)).filter(Boolean) };
    let maisPedidos = { titulo: '', itens: [] };
    if (cfg.mostrarMaisPedidos) {
        const m = await maisPedidosIds();
        maisPedidos = { titulo: m.titulo, itens: m.ids.map((id) => porId.get(id)).filter(Boolean).slice(0, 6) };
    }

    const data = { geradoEm: new Date().toISOString(), totalItens: lista.reduce((n, s) => n + s.itens.length, 0), promocoes, destaques, maisPedidos, secoes: lista };
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
const body0Canal = (req) => (req.body && req.body.canal === 'TOTEM' ? 'TOTEM' : 'ONLINE');

function createPublicApp({ mainApp, getTheme, attachSse, pagesDir, criarPedido, onPedido, push }) {
    const app = express();
    app.disable('x-powered-by');

    app.use((req, res, next) => {
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('Referrer-Policy', 'no-referrer');
        const POSTS = ['/api/public/order', '/api/public/push/subscribe', '/api/public/coupon', '/api/public/rating', '/api/public/whatsapp'];
        const escrita = req.method === 'POST' && POSTS.includes(req.path);
        if (req.method !== 'GET' && req.method !== 'HEAD' && !escrita) {
            return res.status(405).json({ success: false, error: 'Somente leitura' });
        }
        next();
    });
    app.use(express.json({ limit: '20kb', verify: (req, res, buf) => { req.rawBody = buf; } }));

    // limite simples por IP (visitantes na mesma rede)
    const janela = new Map();
    app.use((req, res, next) => {
        const ip = String(req.headers['cf-connecting-ip'] || req.ip || req.socket.remoteAddress || '?');
        req.ipReal = ip;
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
    app.get('/totem', pagina('cardapio.html')); // autoatendimento: mesmo cardapio em modo totem

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
                pedidoOnline: !!getCardapioConfig().pedidoOnline && typeof criarPedido === 'function',
                push: !!push,
                avaliacao: true,
                googleReviewUrl: /^https:\/\//.test(t.googleReviewUrl || '') ? t.googleReviewUrl : '',
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

    // ---- Web Push (aviso de senha pronta) ----
    app.get('/api/public/push/key', (req, res) => {
        if (!push) return res.status(404).json({ success: false, error: 'Indisponível' });
        res.json({ success: true, key: push.publicKey() });
    });
    app.post('/api/public/push/subscribe', (req, res) => {
        try {
            if (!push) return res.status(404).json({ success: false, error: 'Indisponível' });
            push.inscrever(req.body && req.body.senha, req.body && req.body.subscription);
            res.json({ success: true });
        } catch (err) {
            res.status(err.status || 500).json({ success: false, error: err.status ? err.message : 'Não foi possível inscrever' });
        }
    });
    app.get('/sw.js', (req, res) => {
        res.setHeader('Service-Worker-Allowed', '/');
        res.setHeader('Cache-Control', 'no-cache');
        res.sendFile(path.join(pagesDir, 'sw.js'));
    });

    // ---- Pedido online: precos SEMPRE vindos do cadastro (o cliente so envia produto e quantidade) ----
    const pedidosPorIp = new Map();
    app.post('/api/public/order', async (req, res) => {
        try {
            if (!criarPedido || !getCardapioConfig().pedidoOnline) {
                return res.status(403).json({ success: false, error: 'Pedidos pelo cardápio estão desativados' });
            }
            // Baldes separados por canal: o totem e os celulares do Wi-Fi da loja saem pelo MESMO IP publico,
            // entao um nao pode consumir a cota do outro.
            const canalReq = body0Canal(req);
            const ip = `${req.ipReal || req.ip || '?'}|${canalReq}`;
            const agora = Date.now();
            const recentes = (pedidosPorIp.get(ip) || []).filter((t) => agora - t < 10 * 60 * 1000);
            const limitePedidos = canalReq === 'TOTEM' ? 40 : 20;
            if (recentes.length >= limitePedidos) {
                return res.status(429).json({ success: false, error: 'Muitos pedidos em pouco tempo. Aguarde alguns minutos.' });
            }

            const body = req.body || {};
            const bruto = Array.isArray(body.itens) ? body.itens : [];
            if (bruto.length === 0 || bruto.length > 30) {
                return res.status(400).json({ success: false, error: 'Adicione de 1 a 30 itens ao pedido' });
            }
            const menu = await buildMenu();
            const porId = new Map();
            menu.secoes.forEach((s) => s.itens.forEach((i) => porId.set(i.id, i)));

            const somado = new Map();
            for (const it of bruto) {
                const id = parseInt(it && it.id, 10);
                const qtd = parseInt(it && it.qtd, 10);
                if (!Number.isInteger(id) || !porId.has(id)) {
                    return res.status(400).json({ success: false, error: 'Um dos itens não está mais disponível. Atualize o cardápio.' });
                }
                if (!Number.isInteger(qtd) || qtd < 1 || qtd > 20) {
                    return res.status(400).json({ success: false, error: 'Quantidade inválida (de 1 a 20 por item)' });
                }
                somado.set(id, Math.min(20, (somado.get(id) || 0) + qtd));
            }
            const itens = [...somado.entries()].map(([id, qtd]) => {
                const p = porId.get(id);
                return {
                    produtoId: id,
                    descricao: p.nome,
                    quantidade: qtd,
                    valorUnitario: p.precoPromocao !== null ? p.precoPromocao : p.preco
                };
            });
            const nome = String(body.nome || '').replace(/[\u0000-\u001f<>]/g, '').trim().substring(0, 40);
            const canal = body.canal === 'TOTEM' ? 'TOTEM' : 'ONLINE';

            // cupom: desconto calculado AQUI sobre precos do cadastro; consome 1 uso e devolve se o pedido falhar
            const subtotal = round2(itens.reduce((s, i) => s + i.quantidade * i.valorUnitario, 0));
            let cupomUsado = null;
            let desconto = 0;
            if (body.cupom) {
                const v = cupons.reservar(body.cupom, subtotal);
                cupomUsado = v.codigo;
                desconto = v.desconto;
            }

            let r;
            try {
                r = await criarPedido({ nome: nome || (canal === 'TOTEM' ? 'Totem' : 'Pedido online'), comanda: canal, itens, desconto });
            } catch (e) {
                if (cupomUsado) cupons.devolver(cupomUsado);
                throw e;
            }
            recentes.push(agora);
            pedidosPorIp.set(ip, recentes);
            if (pedidosPorIp.size > 5000) pedidosPorIp.clear();
            if (typeof onPedido === 'function') onPedido(r);
            res.json({ success: true, data: { senha: r.senha, id: r.id, total: r.valorTotal, desconto, cupom: cupomUsado } });
        } catch (err) {
            res.status(err.status || 500).json({ success: false, error: err.status ? err.message : 'Não foi possível enviar o pedido agora' });
        }
    });

    // ---- somente leitura: imagem do produto e logotipo (reaproveita os manipuladores da API principal) ----
    app.get('/api/products/:id/image', (req, res, next) => {
        if (!/^\d+$/.test(req.params.id)) return res.status(400).end();
        mainApp(req, res, next);
    });
    app.get('/api/company/logo', (req, res, next) => mainApp(req, res, next));

    // ---- cupom: valida e mostra o desconto (nao consome) ----
    const cuponsPorIp = new Map();
    app.post('/api/public/coupon', async (req, res) => {
        try {
            const ip = req.ipReal || req.ip || '?';
            const agora = Date.now();
            const l = (cuponsPorIp.get(ip) || []).filter((t) => agora - t < 10 * 60 * 1000);
            if (l.length >= 60) return res.status(429).json({ success: false, error: 'Muitas tentativas. Aguarde alguns minutos.' });
            l.push(agora);
            cuponsPorIp.set(ip, l);
            if (cuponsPorIp.size > 5000) cuponsPorIp.clear();

            const menu = await buildMenu();
            const porId = new Map();
            menu.secoes.forEach((s) => s.itens.forEach((i) => porId.set(i.id, i)));
            let subtotal = 0;
            (Array.isArray(req.body && req.body.itens) ? req.body.itens : []).slice(0, 30).forEach((it) => {
                const p = porId.get(parseInt(it && it.id, 10));
                const q = parseInt(it && it.qtd, 10);
                if (p && Number.isInteger(q) && q >= 1 && q <= 20) subtotal += (p.precoPromocao !== null ? p.precoPromocao : p.preco) * q;
            });
            subtotal = round2(subtotal);
            const v = cupons.validar(req.body && req.body.codigo, subtotal);
            res.json({ success: true, data: { codigo: v.codigo, desconto: v.desconto, subtotal, total: round2(subtotal - v.desconto) } });
        } catch (err) {
            res.status(err.status || 500).json({ success: false, error: err.status ? err.message : 'Não foi possível validar o cupom' });
        }
    });

    // ---- upsell: "quem pediu isso tambem levou" (historico de vendas finalizadas, ultimos 90 dias) ----
    const upsellCache = new Map();
    app.get('/api/public/upsell', async (req, res) => {
        try {
            const ids = String(req.query.ids || '').split(',').map((n) => parseInt(n, 10)).filter((n) => Number.isInteger(n) && n > 0).slice(0, 5);
            if (ids.length === 0) return res.json({ success: true, data: [] });
            const chave = ids.slice().sort((a, b) => a - b).join(',');
            const hit = upsellCache.get(chave);
            let lista;
            if (hit && Date.now() - hit.t < 5 * 60 * 1000) lista = hit.lista;
            else {
                const rows = await db.query(
                    `SELECT FIRST 12 I2.PEVI_PRODUTO AS ID, COUNT(*) AS N
                     FROM TB_PEDIDO_VENDA_ITEM I1
                     JOIN TB_PEDIDO_VENDA P ON (P.PEV_EMPRESA = I1.PEVI_EMPRESA AND P.PEV_ID = I1.PEVI_PEDIDO_VENDA)
                     JOIN TB_PEDIDO_VENDA_ITEM I2 ON (I2.PEVI_EMPRESA = I1.PEVI_EMPRESA AND I2.PEVI_PEDIDO_VENDA = I1.PEVI_PEDIDO_VENDA
                                                      AND I2.PEVI_PRODUTO <> I1.PEVI_PRODUTO)
                     WHERE I1.PEVI_PRODUTO IN (${ids.join(',')}) AND P.PEV_STATUS = 'F'
                       AND P.PEV_DT_EMISSAO >= DATEADD(-90 DAY TO (SELECT MAX(PEV_DT_EMISSAO) FROM TB_PEDIDO_VENDA WHERE PEV_STATUS = 'F'))
                     GROUP BY I2.PEVI_PRODUTO
                     ORDER BY 2 DESC`);
                lista = rows.map((r) => parseInt(r.ID, 10)).filter((n) => Number.isInteger(n));
                upsellCache.set(chave, { t: Date.now(), lista });
                if (upsellCache.size > 500) upsellCache.clear();
            }
            const menu = await buildMenu();
            const porId = new Map();
            menu.secoes.forEach((s) => s.itens.forEach((i) => porId.set(i.id, i)));
            const sug = lista.filter((id) => !ids.includes(id) && porId.has(id)).slice(0, 4).map((id) => porId.get(id));
            res.json({ success: true, data: sug });
        } catch (err) {
            res.json({ success: true, data: [] }); // sugestao e opcional: nunca bloqueia o pedido
        }
    });

    // ---- avaliacao do cliente (so de senha ja pronta/entregue) ----
    app.post('/api/public/rating', async (req, res) => {
        try {
            const st = await statusDaSenha(req.body && req.body.senha);
            if (!st.encontrado || (st.estado !== 'PRONTO' && st.estado !== 'ENTREGUE')) {
                return res.status(400).json({ success: false, error: 'Você poderá avaliar quando o pedido estiver pronto.' });
            }
            avaliacoes.registrar({ senha: req.body.senha, nota: req.body.nota, comentario: req.body.comentario });
            res.json({ success: true });
        } catch (err) {
            res.status(err.status || 500).json({ success: false, error: err.status ? err.message : 'Não foi possível registrar a avaliação' });
        }
    });

    // ---- WhatsApp (webhook da Meta) ----
    const bot = whatsapp.criarBot({ buildMenu, criarPedido, onPedido, getTheme });
    app.get('/api/public/whatsapp', (req, res) => {
        const cfg = whatsapp.getConfig();
        if (req.query['hub.mode'] === 'subscribe' && cfg.verifyToken && req.query['hub.verify_token'] === cfg.verifyToken) {
            return res.status(200).send(String(req.query['hub.challenge'] || ''));
        }
        res.status(403).end();
    });
    app.post('/api/public/whatsapp', (req, res) => {
        if (!whatsapp.assinaturaValida(req.rawBody, req.headers['x-hub-signature-256'])) return res.status(401).end();
        res.status(200).json({ success: true }); // responde logo; o processamento segue em segundo plano
        bot.processarWebhook(req.body).catch((e) => console.warn('WhatsApp webhook:', e.message));
    });

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
