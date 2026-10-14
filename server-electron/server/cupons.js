// Cupons de desconto do cardapio digital (config/cupons.json).
// Tipo 'P' = percentual do subtotal, 'V' = valor fixo. Validade, limite de uso e pedido minimo opcionais.
const fs = require('fs');
const path = require('path');

const configDir = process.env.CONFIG_DIR || path.join(__dirname, '..', 'config');
const file = path.join(configDir, 'cupons.json');

const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
const hoje = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

function httpError(status, message) {
    const e = new Error(message);
    e.status = status;
    return e;
}

function carregar() {
    try {
        if (fs.existsSync(file)) {
            const j = JSON.parse(fs.readFileSync(file, 'utf8'));
            if (Array.isArray(j)) return j;
        }
    } catch (e) { /* vazio */ }
    return [];
}
function gravar(lista) {
    fs.mkdirSync(configDir, { recursive: true });
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(lista, null, 2), 'utf8');
    fs.renameSync(tmp, file);
}

const normCodigo = (c) => String(c || '').trim().toUpperCase();

function listar() {
    return carregar();
}

// Substitui a lista (preserva o contador de uso de cupons que ja existiam)
function salvar(entrada) {
    if (!Array.isArray(entrada)) throw httpError(400, 'Lista de cupons inválida');
    if (entrada.length > 100) throw httpError(400, 'Máximo de 100 cupons');
    const atuais = new Map(carregar().map((c) => [c.codigo, c]));
    const vistos = new Set();
    const out = entrada.map((c, i) => {
        const codigo = normCodigo(c.codigo);
        if (!/^[A-Z0-9_-]{3,20}$/.test(codigo)) throw httpError(400, `Cupom ${i + 1}: código deve ter 3 a 20 letras/números`);
        if (vistos.has(codigo)) throw httpError(400, `Cupom repetido: ${codigo}`);
        vistos.add(codigo);
        const tipo = c.tipo === 'V' ? 'V' : 'P';
        const valor = round2(parseFloat(c.valor));
        if (!isFinite(valor) || valor <= 0) throw httpError(400, `${codigo}: valor inválido`);
        if (tipo === 'P' && valor > 100) throw httpError(400, `${codigo}: percentual máximo é 100`);
        let validoAte = null;
        if (c.validoAte) {
            if (!/^\d{4}-\d{2}-\d{2}$/.test(String(c.validoAte))) throw httpError(400, `${codigo}: data inválida`);
            validoAte = String(c.validoAte);
        }
        const limite = c.limiteUso === null || c.limiteUso === undefined || c.limiteUso === '' ? null : parseInt(c.limiteUso, 10);
        if (limite !== null && (!Number.isInteger(limite) || limite < 1)) throw httpError(400, `${codigo}: limite de uso inválido`);
        const minimo = c.minimo ? round2(parseFloat(c.minimo)) : 0;
        if (!isFinite(minimo) || minimo < 0) throw httpError(400, `${codigo}: pedido mínimo inválido`);
        const antigo = atuais.get(codigo);
        return { codigo, tipo, valor, validoAte, limiteUso: limite, minimo, ativo: c.ativo !== false, usados: antigo ? antigo.usados || 0 : 0 };
    });
    gravar(out);
    return out;
}

// Valida o cupom para o subtotal e devolve o desconto. Lanca 400 com o motivo.
function validar(codigo, subtotal) {
    const cod = normCodigo(codigo);
    const c = carregar().find((x) => x.codigo === cod);
    if (!c || !c.ativo) throw httpError(400, 'Cupom inválido');
    if (c.validoAte && c.validoAte < hoje()) throw httpError(400, 'Cupom vencido');
    if (c.limiteUso !== null && (c.usados || 0) >= c.limiteUso) throw httpError(400, 'Cupom esgotado');
    if (subtotal < (c.minimo || 0)) throw httpError(400, `Pedido mínimo de R$ ${c.minimo.toFixed(2).replace('.', ',')} para este cupom`);
    let desconto = c.tipo === 'P' ? round2((subtotal * c.valor) / 100) : Math.min(c.valor, subtotal);
    desconto = Math.min(round2(desconto), round2(subtotal));
    return { codigo: c.codigo, desconto, tipo: c.tipo, valor: c.valor };
}

// Valida e consome 1 uso (operacao sincrona = atomica neste processo). Use devolver() se o pedido falhar.
function reservar(codigo, subtotal) {
    const v = validar(codigo, subtotal);
    const lista = carregar();
    const c = lista.find((x) => x.codigo === v.codigo);
    c.usados = (c.usados || 0) + 1;
    gravar(lista);
    return v;
}
function devolver(codigo) {
    const lista = carregar();
    const c = lista.find((x) => x.codigo === normCodigo(codigo));
    if (c && c.usados > 0) { c.usados -= 1; gravar(lista); }
}

module.exports = { listar, salvar, validar, reservar, devolver };
