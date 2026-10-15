// Portas de cada funcao (config/ports.json). Mudancas valem apos reiniciar o servidor.
const fs = require('fs');
const path = require('path');

const DEFAULTS = { api: 8080, tv: 8081, orders: 8082, public: 8083 };
const KEYS = Object.keys(DEFAULTS);
const file = () => path.join(process.env.CONFIG_DIR || path.join(__dirname, '..', 'config'), 'ports.json');

function get() {
    let saved = {};
    try { saved = JSON.parse(fs.readFileSync(file(), 'utf8')); } catch (e) { /* padrao */ }
    const out = {};
    for (const k of KEYS) {
        const n = parseInt(saved[k], 10);
        out[k] = n >= 1 && n <= 65535 ? n : DEFAULTS[k];
    }
    return out;
}

function validate(input) {
    const out = {};
    const used = new Set();
    for (const k of KEYS) {
        const n = parseInt(input && input[k], 10);
        if (!(n >= 1024 && n <= 65535)) throw new Error(`Porta inválida (${k}): use um número entre 1024 e 65535`);
        if (used.has(n)) throw new Error(`A porta ${n} está repetida: cada função precisa de uma porta diferente`);
        used.add(n);
        out[k] = n;
    }
    return out;
}

function save(input) {
    const v = validate(input);
    fs.mkdirSync(path.dirname(file()), { recursive: true });
    fs.writeFileSync(file(), JSON.stringify(v, null, 2));
    return v;
}

module.exports = { DEFAULTS, get, save, validate };
