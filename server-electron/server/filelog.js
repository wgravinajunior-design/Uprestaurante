// Log persistente em arquivo (um arquivo por dia, com rotacao). Pasta: <dados>/logs (ou LOG_DIR).
const fs = require('fs');
const path = require('path');

const MANTER_DIAS = parseInt(process.env.LOG_DAYS || '14', 10);
const MAX_MB_DIA = 20; // protecao: para de gravar no dia se passar disso

function dir() {
    if (process.env.LOG_DIR) return process.env.LOG_DIR;
    const cfg = process.env.CONFIG_DIR || path.join(__dirname, '..', 'config');
    return path.join(path.dirname(cfg), 'logs');
}

const pad = (n) => String(n).padStart(2, '0');
function hoje(d = new Date()) {
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

let fila = [];
let timer = null;
let diaEscrito = '';
let bytesDia = 0;
let pronto = false;

function garantirPasta() {
    try {
        fs.mkdirSync(dir(), { recursive: true });
        pronto = true;
    } catch (e) { pronto = false; }
}

function rotacionar() {
    try {
        const limite = Date.now() - MANTER_DIAS * 86400000;
        for (const nome of fs.readdirSync(dir())) {
            if (!/^server-\d{4}-\d{2}-\d{2}\.log$/.test(nome)) continue;
            const p = path.join(dir(), nome);
            if (fs.statSync(p).mtimeMs < limite) fs.unlinkSync(p);
        }
    } catch (e) { /* sem pasta/permissao: ignora */ }
}

function descarregar() {
    timer = null;
    if (!fila.length) return;
    const linhas = fila.join('');
    fila = [];
    if (!pronto) garantirPasta();
    if (!pronto) return;
    const dia = hoje();
    if (dia !== diaEscrito) { diaEscrito = dia; bytesDia = 0; rotacionar(); }
    if (bytesDia > MAX_MB_DIA * 1024 * 1024) return;
    bytesDia += Buffer.byteLength(linhas);
    fs.appendFile(path.join(dir(), `server-${dia}.log`), linhas, () => {});
}

function escrever(tipo, mensagem) {
    const d = new Date();
    const hora = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
    fila.push(`${hoje(d)} ${hora} [${tipo}] ${String(mensagem).replace(/\r?\n/g, ' ')}\n`);
    if (fila.length > 5000) fila = fila.slice(-2500);
    if (!timer) {
        timer = setTimeout(descarregar, 1000);
        if (timer.unref) timer.unref();
    }
}

// Remove dados pessoais/segredos de uma mensagem antes de ir para a tela ou para o arquivo:
// e-mail, CPF/CNPJ, telefone, JWT, pares chave=valor sensiveis e sequencias longas (chaves/tokens).
const RE_EMAIL = new RegExp('[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}', 'g');
const RE_CPF = new RegExp('\\b\\d{3}\\.?\\d{3}\\.?\\d{3}-?\\d{2}\\b', 'g');
const RE_CNPJ = new RegExp('\\b\\d{2}\\.?\\d{3}\\.?\\d{3}/?\\d{4}-?\\d{2}\\b', 'g');
const RE_FONE = new RegExp('(?:\\+?55)?\\s?\\(?\\d{2}\\)?\\s?9?\\d{4}[-\\s]?\\d{4}\\b', 'g');
const RE_JWT = new RegExp('\\beyJ[A-Za-z0-9_-]{10,}\\.[A-Za-z0-9_-]{10,}(?:\\.[A-Za-z0-9_-]*)?', 'g');
const RE_SEGREDO_KV = new RegExp('\\b(token|senha|password|passwd|secret|authorization|apikey|api_key)(["\']?\\s*[:=]\\s*["\']?)[^\\s"\',;&]+', 'gi');
const RE_LONGO = new RegExp('\\b[A-Za-z0-9_-]{40,}\\b', 'g');

function sanitizar(msg) {
    let t = String(msg == null ? '' : msg);
    t = t.replace(RE_EMAIL, '[email]');
    t = t.replace(RE_CPF, '[cpf]');
    t = t.replace(RE_CNPJ, '[cnpj]');
    t = t.replace(RE_FONE, '[telefone]');
    t = t.replace(RE_JWT, '[token]');
    t = t.replace(RE_SEGREDO_KV, '$1$2[oculto]');
    t = t.replace(RE_LONGO, '[segredo]');
    if (t.length > 600) t = t.slice(0, 600) + '…';
    return t;
}

module.exports = { escrever, dir, descarregar, sanitizar };
