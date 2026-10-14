// Web Push: avisa o celular do cliente quando a senha fica pronta (funciona com a tela bloqueada).
// Chaves VAPID geradas uma vez em config/push.json; inscricoes por senha/dia em config/push_subs.json.
const webpush = require('web-push');
const fs = require('fs');
const path = require('path');

const configDir = process.env.CONFIG_DIR || path.join(__dirname, '..', 'config');
const keysFile = path.join(configDir, 'push.json');
const subsFile = path.join(configDir, 'push_subs.json');

const tentativas = new Map(); // chave senha/dia -> falhas transitorias de envio
let keys = null;
let getSubject = () => 'mailto:sistema@localhost.invalid';
let timer = null;

function lerJson(file, padrao) {
    try { if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { /* padrao */ }
    return padrao;
}
function gravarJson(file, data) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data), 'utf8');
    fs.renameSync(tmp, file);
}

function carregarChaves() {
    if (keys) return keys;
    keys = lerJson(keysFile, null);
    if (!keys || !keys.publicKey || !keys.privateKey) {
        keys = webpush.generateVAPIDKeys();
        gravarJson(keysFile, keys);
    }
    return keys;
}

const hoje = () => new Date().toISOString().substring(0, 10);
function chave(senha) { return `${hoje()}:${parseInt(senha, 10)}`; }

function publicKey() {
    return carregarChaves().publicKey;
}

function inscrever(senha, sub) {
    const n = parseInt(senha, 10);
    if (!Number.isInteger(n) || n < 0 || n > 999999) throw Object.assign(new Error('Senha inválida'), { status: 400 });
    if (!sub || typeof sub.endpoint !== 'string' || !/^https:\/\//.test(sub.endpoint) || sub.endpoint.length > 600
        || !sub.keys || typeof sub.keys.p256dh !== 'string' || typeof sub.keys.auth !== 'string') {
        throw Object.assign(new Error('Inscrição inválida'), { status: 400 });
    }
    const todas = lerJson(subsFile, {});
    const h = hoje();
    Object.keys(todas).forEach((k) => { if (!k.startsWith(h + ':')) delete todas[k]; }); // descarta dias antigos
    const k = chave(n);
    const lista = todas[k] || [];
    if (!lista.some((s) => s.endpoint === sub.endpoint)) {
        if (lista.length >= 5) lista.shift();
        lista.push({ endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth } });
    }
    todas[k] = lista;
    gravarJson(subsFile, todas);
}

async function enviar(sub, payload) {
    const c = carregarChaves();
    webpush.setVapidDetails(getSubject(), c.publicKey, c.privateKey);
    return webpush.sendNotification(sub, JSON.stringify(payload), { TTL: 3600 });
}

// Vigia as senhas inscritas; quando ficam PRONTAS envia o push e remove a inscricao.
function iniciar({ statusDaSenha, subject }) {
    if (timer) return;
    if (subject) getSubject = subject;
    timer = setInterval(async () => {
        const todas = lerJson(subsFile, {});
        const h = hoje();
        const pend = Object.keys(todas).filter((k) => k.startsWith(h + ':') && todas[k].length);
        if (pend.length === 0) return;
        let mudou = false;
        for (const k of pend) {
            const senha = k.split(':')[1];
            try {
                const st = await statusDaSenha(senha);
                if (!st.encontrado) continue;
                if (st.estado !== 'PRONTO' && st.estado !== 'ENTREGUE' && st.estado !== 'CANCELADO') continue;
                const msg = st.estado === 'CANCELADO'
                    ? { titulo: 'Pedido cancelado', corpo: `A senha ${st.senha} foi cancelada. Fale com o atendimento.` }
                    : { titulo: 'Pedido pronto! 🎉', corpo: `Sua senha ${st.senha} está pronta. Retire no balcão.` };
                let enviados = 0;
                let transitorios = 0;
                for (const sub of todas[k]) {
                    try {
                        await enviar(sub, { ...msg, senha: st.senha, url: `/senha?s=${parseInt(senha, 10)}` });
                        enviados++;
                    } catch (e) {
                        // 404/410 = inscricao expirada (descarta); outros erros: tenta de novo no proximo ciclo
                        if (e && (e.statusCode === 404 || e.statusCode === 410)) continue;
                        transitorios++;
                        console.warn('Push:', e && (e.body || e.message) ? String(e.body || e.message).slice(0, 160) : e);
                    }
                }
                if (enviados === 0 && transitorios > 0) {
                    const t = (tentativas.get(k) || 0) + 1;
                    tentativas.set(k, t);
                    if (t < 10) continue; // mantem a inscricao para nova tentativa
                }
                tentativas.delete(k);
                delete todas[k];
                mudou = true;
            } catch (e) { /* tenta no proximo ciclo */ }
        }
        if (mudou) gravarJson(subsFile, todas);
    }, 6000);
    if (timer.unref) timer.unref();
}

module.exports = { publicKey, inscrever, iniciar };
