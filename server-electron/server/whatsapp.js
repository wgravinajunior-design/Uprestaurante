// Pedido por WhatsApp (WhatsApp Business Cloud API da Meta).
// O cliente escreve os itens ("2 suco de laranja, 1 coxinha"), o sistema confirma o total e, com "SIM",
// cria o pedido e responde com a senha. Configuracao em config/whatsapp.json (token fica so no servidor).
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const configDir = process.env.CONFIG_DIR || path.join(__dirname, '..', 'config');
const cfgFile = path.join(configDir, 'whatsapp.json');
const PADRAO = { ativo: false, token: '', phoneNumberId: '', verifyToken: '', appSecret: '' };

function getConfig() {
    try {
        if (fs.existsSync(cfgFile)) return { ...PADRAO, ...JSON.parse(fs.readFileSync(cfgFile, 'utf8')) };
    } catch (e) { /* padrao */ }
    return { ...PADRAO };
}

// Nunca devolve segredos para a tela
function configPublica() {
    const c = getConfig();
    return { ativo: c.ativo, phoneNumberId: c.phoneNumberId, verifyToken: c.verifyToken, temToken: !!c.token, temAppSecret: !!c.appSecret };
}

function salvarConfig(e) {
    const cur = getConfig();
    const next = {
        ativo: e.ativo === true || e.ativo === 'true',
        phoneNumberId: String(e.phoneNumberId || '').trim().substring(0, 40),
        verifyToken: String(e.verifyToken || '').trim().substring(0, 80) || cur.verifyToken || crypto.randomBytes(12).toString('hex'),
        token: e.token ? String(e.token).trim() : cur.token,
        appSecret: e.appSecret ? String(e.appSecret).trim() : cur.appSecret
    };
    if (next.ativo && (!next.token || !next.phoneNumberId || !next.appSecret)) {
        const err = new Error('Informe o token, o ID do número e o App Secret (valida que as mensagens vêm da Meta) para ativar');
        err.status = 400;
        throw err;
    }
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(cfgFile, JSON.stringify(next, null, 2), 'utf8');
    return configPublica();
}

// ---------------------------------------------------------------------------
// Interpretacao do texto
// ---------------------------------------------------------------------------
const semAcento = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const tokens = (s) => semAcento(s).replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter((t) => t.length > 0);
const STOP = new Set(['de', 'do', 'da', 'com', 'um', 'uma', 'o', 'a', 'e', 'por', 'favor', 'quero', 'queria', 'gostaria']);

const NUMEROS = { um: 1, uma: 1, dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9, dez: 10 };

function dinheiro(v) {
    return 'R$ ' + Number(v).toFixed(2).replace('.', ',');
}

// "2 suco de laranja, 1 coxinha e 3 pao de queijo" -> [{ qtd, texto }]
function separarPedido(texto) {
    return semAcento(texto)
        .replace(/\b(quero|queria|gostaria de|gostaria|me ve|me manda|por favor|pfv|pf)\b/g, ' ')
        .replace(/\s+e\s+/g, ',')
        .split(/[,;\n+]+/)
        .map((p) => p.trim())
        .filter(Boolean)
        .map((p) => {
            const m = p.match(/^(\d{1,2})\s*x?\s+(.*)$/) || p.match(/^(um|uma|dois|duas|tres|quatro|cinco|seis|sete|oito|nove|dez)\s+(.*)$/);
            if (m) return { qtd: NUMEROS[m[1]] || parseInt(m[1], 10), texto: m[2] };
            return { qtd: 1, texto: p };
        })
        .filter((x) => x.texto && x.qtd >= 1 && x.qtd <= 20);
}

// Melhor item do cardapio para o texto: todos os termos precisam aparecer no nome
function acharItem(menuItens, texto) {
    const q = tokens(texto).filter((t) => !STOP.has(t));
    if (q.length === 0) return { tipo: 'nenhum' };
    const pontuados = menuItens
        .map((i) => {
            const nome = tokens(i.nome);
            const todos = q.every((t) => nome.some((n) => n === t || n.startsWith(t) || (t.length > 3 && n.includes(t))));
            if (!todos) return null;
            const exato = q.length === nome.filter((n) => !STOP.has(n)).length;
            return { item: i, score: (exato ? 100 : 0) - nome.length };
        })
        .filter(Boolean)
        .sort((a, b) => b.score - a.score);
    if (pontuados.length === 0) return { tipo: 'nenhum' };
    // so decide sozinho quando o texto bate exatamente com UM item (ou ha uma unica opcao)
    if (pontuados.length === 1) return { tipo: 'ok', item: pontuados[0].item };
    if (pontuados[0].score >= 0 && pontuados[0].score > pontuados[1].score) return { tipo: 'ok', item: pontuados[0].item };
    return { tipo: 'ambiguo', opcoes: pontuados.slice(0, 4).map((p) => p.item) };
}

// ---------------------------------------------------------------------------
// Conversa
// ---------------------------------------------------------------------------
function criarBot({ buildMenu, criarPedido, onPedido, getTheme }) {
    const pendentes = new Map(); // telefone -> { itens, total, ts }
    const msgs = new Map();      // telefone -> timestamps (limite)

    function permitido(tel) {
        const agora = Date.now();
        const l = (msgs.get(tel) || []).filter((t) => agora - t < 60000);
        l.push(agora);
        msgs.set(tel, l);
        if (msgs.size > 5000) msgs.clear();
        return l.length <= 12;
    }

    async function responder(tel, texto) {
        const cfg = getConfig();
        if (!cfg.token || !cfg.phoneNumberId) return;
        try {
            await fetch(`https://graph.facebook.com/v20.0/${encodeURIComponent(cfg.phoneNumberId)}/messages`, {
                method: 'POST',
                headers: { Authorization: `Bearer ${cfg.token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ messaging_product: 'whatsapp', to: tel, type: 'text', text: { body: texto, preview_url: true } })
            });
        } catch (e) { console.warn('WhatsApp envio:', e.message); }
    }

    // Processa uma mensagem de texto; devolve a resposta (e a envia)
    async function tratar(tel, textoBruto) {
        const texto = String(textoBruto || '').trim().substring(0, 600);
        const t = semAcento(texto).replace(/[^a-z0-9 ]/g, '').trim();
        const tema = getTheme ? getTheme() : {};
        const loja = tema.nome || 'nossa loja';
        const base = (tema.publicUrl || '').replace(/\/+$/, '');

        if (/^(oi|ola|menu|cardapio|bom dia|boa tarde|boa noite|ajuda)\b/.test(t)) {
            return `Olá! Bem-vindo(a) à ${loja} 😊\n` +
                (base ? `Veja o cardápio: ${base}/cardapio\n\n` : '\n') +
                'Para pedir, envie os itens e as quantidades. Exemplo:\n*2 suco de laranja, 1 coxinha*\n\nVou conferir e te passo o total.';
        }
        if (/^(nao|cancelar|cancela|desistir)$/.test(t)) {
            pendentes.delete(tel);
            return 'Pedido cancelado. Quando quiser, é só enviar os itens novamente.';
        }
        if (/^(sim|confirmo|confirmar|confirma|ok|pode)$/.test(t)) {
            const p = pendentes.get(tel);
            if (!p || Date.now() - p.ts > 10 * 60 * 1000) {
                pendentes.delete(tel);
                return 'Não tenho um pedido aguardando confirmação. Envie os itens que você quer.';
            }
            pendentes.delete(tel);
            try {
                const r = await criarPedido({
                    nome: 'WhatsApp ' + tel.slice(-4), comanda: 'WHATSAPP',
                    itens: p.itens.map((i) => ({ produtoId: i.id, descricao: i.nome, quantidade: i.qtd, valorUnitario: i.preco }))
                });
                if (typeof onPedido === 'function') onPedido(r);
                return `✅ Pedido confirmado!\n*Sua senha é ${r.senha}*\nTotal: ${dinheiro(r.valorTotal)} (pague no balcão)\n` +
                    (base ? `Acompanhe: ${base}/senha?s=${parseInt(r.senha, 10)}` : 'Avisaremos quando estiver pronto.');
            } catch (e) {
                return 'Não consegui registrar o pedido agora. Tente novamente em instantes.';
            }
        }

        // interpretar itens
        const partes = separarPedido(texto);
        if (partes.length === 0) {
            return 'Não entendi. Envie os itens e quantidades, por exemplo:\n*2 suco de laranja, 1 coxinha*';
        }
        const menu = await buildMenu();
        const todos = [];
        menu.secoes.forEach((s) => s.itens.forEach((i) => todos.push(i)));

        const itens = [];
        for (const p of partes) {
            const r = acharItem(todos, p.texto);
            if (r.tipo === 'nenhum') return `Não encontrei "${p.texto}" no cardápio. Confira o nome e envie novamente.`;
            if (r.tipo === 'ambiguo') {
                return `Encontrei mais de uma opção para "${p.texto}":\n` + r.opcoes.map((o) => `• ${o.nome}`).join('\n') +
                    '\nEnvie o pedido de novo com o nome completo do item.';
            }
            const preco = r.item.precoPromocao !== null ? r.item.precoPromocao : r.item.preco;
            const ja = itens.find((x) => x.id === r.item.id);
            if (ja) ja.qtd = Math.min(20, ja.qtd + p.qtd);
            else itens.push({ id: r.item.id, nome: r.item.nome, qtd: p.qtd, preco });
        }
        const total = itens.reduce((s, i) => s + i.qtd * i.preco, 0);
        pendentes.set(tel, { itens, total, ts: Date.now() });
        return 'Confira seu pedido:\n' + itens.map((i) => `${i.qtd}x ${i.nome} — ${dinheiro(i.qtd * i.preco)}`).join('\n') +
            `\n\n*Total: ${dinheiro(total)}*\nResponda *SIM* para confirmar ou *NÃO* para cancelar.`;
    }

    // Entrada do webhook (payload da Meta)
    async function processarWebhook(payload) {
        const cfg = getConfig();
        if (!cfg.ativo) return;
        const mensagens = [];
        ((payload && payload.entry) || []).forEach((e) => (e.changes || []).forEach((c) => {
            ((c.value && c.value.messages) || []).forEach((m) => mensagens.push(m));
        }));
        for (const m of mensagens) {
            const tel = String(m.from || '').replace(/\D/g, '');
            if (!tel || tel.length > 20) continue;
            if (m.type !== 'text' || !m.text) {
                await responder(tel, 'Por enquanto só consigo ler mensagens de texto. Envie os itens por escrito, por favor.');
                continue;
            }
            if (!permitido(tel)) continue;
            try {
                await responder(tel, await tratar(tel, m.text.body));
            } catch (e) {
                console.warn('WhatsApp tratar:', e.message);
            }
        }
    }

    return { processarWebhook, tratar };
}

// Confere a assinatura X-Hub-Signature-256 (obrigatoria quando ha appSecret)
function assinaturaValida(rawBody, header) {
    const cfg = getConfig();
    // Sem App Secret nao ha como provar que a mensagem veio da Meta: qualquer um poderia forjar pedidos.
    if (!cfg.appSecret) return false;
    const esperado = 'sha256=' + crypto.createHmac('sha256', cfg.appSecret).update(rawBody || Buffer.alloc(0)).digest('hex');
    const a = Buffer.from(esperado);
    const b = Buffer.from(String(header || ''));
    return a.length === b.length && crypto.timingSafeEqual(a, b);
}

module.exports = { getConfig, configPublica, salvarConfig, criarBot, assinaturaValida, separarPedido, acharItem };
