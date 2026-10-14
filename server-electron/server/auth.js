// Login pelas credenciais da TB_USUARIO (USU_LOGIN / USU_SENHA, usuarios com USU_STATUS = 'A').
// Sessao: cookie HttpOnly assinado (HMAC). Exigido para acessos que chegam pela internet (tunel Cloudflare)
// ou, com AUTH_LAN=1, tambem para qualquer maquina da rede. Acesso direto do proprio servidor continua livre.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const db = require('./db');

const COOKIE = 'dusuco_auth';
const TTL_MS = 12 * 60 * 60 * 1000;
const SECRET_PATH = path.join(__dirname, '..', 'config', 'auth_secret.json');

function loadSecret() {
    try {
        const j = JSON.parse(fs.readFileSync(SECRET_PATH, 'utf8'));
        if (j.secret) return j.secret;
    } catch (e) { /* gera abaixo */ }
    const secret = crypto.randomBytes(32).toString('hex');
    try {
        fs.mkdirSync(path.dirname(SECRET_PATH), { recursive: true });
        fs.writeFileSync(SECRET_PATH, JSON.stringify({ secret }), 'utf8');
    } catch (e) { /* segue com segredo em memoria */ }
    return secret;
}
const SECRET = loadSecret();

const b64 = (b) => Buffer.from(b).toString('base64url');
const sign = (data) => crypto.createHmac('sha256', SECRET).update(data).digest('base64url');

function safeEq(a, b) {
    const x = Buffer.from(String(a));
    const y = Buffer.from(String(b));
    return x.length === y.length && crypto.timingSafeEqual(x, y);
}

function issue(user) {
    const payload = b64(JSON.stringify({ id: user.id, login: user.login, exp: Date.now() + TTL_MS }));
    return `${payload}.${sign(payload)}`;
}

function verify(token) {
    if (!token || typeof token !== 'string') return null;
    const [payload, sig] = token.split('.');
    if (!payload || !sig || !safeEq(sig, sign(payload))) return null;
    try {
        const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
        return data.exp > Date.now() ? data : null;
    } catch (e) { return null; }
}

function readCookie(req, name) {
    const raw = req.headers.cookie || '';
    for (const part of raw.split(';')) {
        const i = part.indexOf('=');
        if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
    }
    return '';
}

function sessionOf(req) {
    const h = req.headers.authorization || '';
    const bearer = h.startsWith('Bearer ') ? h.slice(7) : '';
    return verify(readCookie(req, COOKIE) || bearer || req.headers['x-auth-token']);
}

// true quando a requisicao veio de fora do servidor (tunel Cloudflare ou, opcionalmente, rede local)
function isRemote(req) {
    if (req.headers['cf-connecting-ip'] || req.headers['cf-ray'] || req.headers['x-forwarded-for']) return true;
    if (process.env.AUTH_LAN === '1') {
        const a = String(req.socket && req.socket.remoteAddress || '');
        return !(a === '::1' || a === '127.0.0.1' || a === '::ffff:127.0.0.1');
    }
    return false;
}

function isSecure(req) {
    return req.secure || req.headers['x-forwarded-proto'] === 'https' || /https/i.test(String(req.headers['cf-visitor'] || ''));
}

// Limite de tentativas por IP (10 falhas / 10 min)
const fails = new Map();
function clientIp(req) { return String(req.headers['cf-connecting-ip'] || (req.socket && req.socket.remoteAddress) || ''); }
function blocked(ip) {
    const f = fails.get(ip);
    if (!f) return false;
    if (Date.now() - f.first > 10 * 60 * 1000) { fails.delete(ip); return false; }
    return f.n >= 10;
}
function fail(ip) {
    const f = fails.get(ip);
    if (!f || Date.now() - f.first > 10 * 60 * 1000) fails.set(ip, { n: 1, first: Date.now() });
    else f.n++;
}

async function login(req, res) {
    const ip = clientIp(req);
    if (blocked(ip)) return res.status(429).json({ success: false, error: 'Muitas tentativas. Aguarde alguns minutos.' });
    const loginName = String((req.body && req.body.login) || '').trim();
    const senha = String((req.body && req.body.senha) || '');
    if (!loginName || !senha) return res.status(400).json({ success: false, error: 'Informe usuário e senha' });
    try {
        const rows = await db.query(
            "SELECT USU_ID, USU_LOGIN, USU_NOME, USU_SENHA, USU_STATUS FROM TB_USUARIO WHERE UPPER(USU_LOGIN) = ?",
            [loginName.toUpperCase()]
        );
        const u = rows.find((r) => String(r.USU_STATUS || '').toUpperCase() === 'A' && safeEq(r.USU_SENHA || '', senha));
        if (!u) {
            fail(ip);
            return res.status(401).json({ success: false, error: 'Usuário ou senha inválidos' });
        }
        fails.delete(ip);
        const token = issue({ id: u.USU_ID, login: u.USU_LOGIN });
        res.setHeader('Set-Cookie',
            `${COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${TTL_MS / 1000}${isSecure(req) ? '; Secure' : ''}`);
        res.json({ success: true, data: { login: u.USU_LOGIN, nome: u.USU_NOME }, token });
    } catch (e) {
        res.status(500).json({ success: false, error: 'Não foi possível validar o login' });
    }
}

function logout(req, res) {
    res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
    res.json({ success: true });
}

// Rotas publicas (sem login) usadas pela TV: somente leitura
const TV_PUBLIC_GET = [
    /^\/api\/events$/,
    /^\/api\/company$/,
    /^\/api\/company\/logo$/,
    /^\/api\/tv\/(promotions|banners|calls)$/,
    /^\/api\/tv\/banners\/file\/[^/]+$/,
    /^\/api\/products\/\d+\/image$/
];

// Protege /api: exige sessao para acessos remotos, exceto login e a leitura publica da TV
function apiGuard(req, res, next) {
    if (!isRemote(req)) return next();
    const p = req.baseUrl ? (req.baseUrl + req.path) : req.path;
    if (p === '/api/auth/login' || p === '/api/auth/logout') return next();
    if ((req.method === 'GET' || req.method === 'HEAD') && TV_PUBLIC_GET.some((re) => re.test(p))) return next();
    if (sessionOf(req)) return next();
    res.status(401).json({ success: false, error: 'Login necessário' });
}

// Protege paginas: remoto sem sessao vai para /login. `only` limita a certos caminhos (ex.: admin da TV)
function pageGuard(only) {
    return (req, res, next) => {
        if (!isRemote(req)) return next();
        if (req.path === '/login' || req.path.startsWith('/api/')) return next();
        if (only && !only.test(req.path)) return next();
        if (sessionOf(req)) return next();
        res.redirect('/login?next=' + encodeURIComponent(req.originalUrl));
    };
}

function loginPage(req, res) {
    res.sendFile(path.join(__dirname, '..', 'auth_display', 'login.html'));
}

module.exports = { login, logout, apiGuard, pageGuard, loginPage, sessionOf, isRemote };
