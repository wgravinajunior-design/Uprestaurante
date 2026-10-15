// Gerenciador do tunel Cloudflare (cloudflared): quick tunnel (URL trycloudflare) ou tunel nomeado (token)
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const CFG_PATH = path.join(process.env.CONFIG_DIR || path.join(__dirname, '..', 'config'), 'tunnel.json');
const DEFAULTS = { mode: 'quick', port: 8083, token: '', hostname: '', autoStart: false, exe: '' };
const MAX_LOG = 60;

let proc = null;
let state = { running: false, url: '', error: '', log: [] };
let logFn = () => {};

function readCfg() {
    try {
        if (fs.existsSync(CFG_PATH)) return { ...DEFAULTS, ...JSON.parse(fs.readFileSync(CFG_PATH, 'utf8')) };
    } catch (e) { /* usa padrao */ }
    return { ...DEFAULTS };
}

function writeCfg(cfg) {
    fs.mkdirSync(path.dirname(CFG_PATH), { recursive: true });
    fs.writeFileSync(CFG_PATH, JSON.stringify(cfg, null, 2), 'utf8');
}

function findExe(custom) {
    const candidates = [
        custom,
        process.env.CLOUDFLARED_PATH,
        process.resourcesPath && path.join(process.resourcesPath, 'bin', 'cloudflared.exe'), // embutido no instalador
        path.join(__dirname, '..', 'bin', 'cloudflared.exe'),
        'C:\\Program Files (x86)\\cloudflared\\cloudflared.exe',
        'C:\\Program Files\\cloudflared\\cloudflared.exe',
        'C:\\Program Files\\Cloudflare\\Cloudflared\\cloudflared.exe'
    ].filter(Boolean);
    for (const c of candidates) { try { if (fs.existsSync(c)) return c; } catch (e) { /* segue */ } }
    return 'cloudflared'; // tenta o PATH
}

function pushLog(line) {
    const t = String(line).trim();
    if (!t) return;
    state.log.push(t);
    if (state.log.length > MAX_LOG) state.log.shift();
}

function publicStatus() {
    const c = readCfg();
    return {
        running: state.running,
        url: state.url,
        error: state.error,
        log: state.log.slice(-15),
        config: { mode: c.mode, port: c.port, hostname: c.hostname, autoStart: c.autoStart, hasToken: !!c.token, exe: c.exe }
    };
}

function stop() {
    if (proc) {
        try { proc.kill(); } catch (e) { /* ignora */ }
        proc = null;
    }
    state.running = false;
    state.url = '';
    return publicStatus();
}

function start() {
    if (proc) return publicStatus();
    const cfg = readCfg();
    const exe = findExe(cfg.exe);
    let args;
    if (cfg.mode === 'token') {
        if (!cfg.token) { state.error = 'Informe o token do túnel'; return publicStatus(); }
        args = ['tunnel', '--no-autoupdate', 'run', '--token', cfg.token];
    } else {
        args = ['tunnel', '--no-autoupdate', '--url', `http://localhost:${cfg.port}`];
    }
    state = { running: false, url: cfg.mode === 'token' ? (cfg.hostname ? `https://${cfg.hostname.replace(/^https?:\/\//, '')}` : '') : '', error: '', log: [] };
    try {
        proc = spawn(exe, args, { windowsHide: true });
    } catch (e) {
        state.error = 'Falha ao iniciar cloudflared: ' + e.message;
        proc = null;
        return publicStatus();
    }
    state.running = true;
    const onData = (buf) => {
        String(buf).split(/\r?\n/).forEach((l) => {
            pushLog(l);
            const m = l.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/i);
            if (m && cfg.mode !== 'token') { state.url = m[0]; logFn('SYSTEM', `Túnel Cloudflare ativo: ${m[0]}`); }
        });
    };
    proc.stdout.on('data', onData);
    proc.stderr.on('data', onData);
    proc.on('error', (e) => {
        state.error = e.code === 'ENOENT' ? 'cloudflared não encontrado. Instale ou informe o caminho.' : e.message;
        state.running = false;
        proc = null;
        logFn('ERROR', 'Túnel Cloudflare: ' + state.error);
    });
    proc.on('exit', (code) => {
        if (proc) { state.error = state.error || `cloudflared encerrou (código ${code})`; }
        proc = null;
        state.running = false;
    });
    return publicStatus();
}

function saveConfig(input) {
    const cur = readCfg();
    const mode = input.mode === 'token' ? 'token' : 'quick';
    const port = parseInt(input.port, 10);
    if (!(port > 0 && port < 65536)) { const e = new Error('Porta inválida'); e.status = 400; throw e; }
    const next = {
        ...cur,
        mode,
        port,
        hostname: String(input.hostname || '').trim(),
        autoStart: !!input.autoStart,
        exe: String(input.exe || '').trim(),
        token: input.token ? String(input.token).trim() : cur.token
    };
    writeCfg(next);
    return publicStatus();
}

function init(log) {
    logFn = log || logFn;
    if (readCfg().autoStart) start();
}

process.on('exit', () => { if (proc) { try { proc.kill(); } catch (e) { /* ignora */ } } });

module.exports = { init, start, stop, status: publicStatus, saveConfig };
