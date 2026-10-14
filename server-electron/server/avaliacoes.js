// Avaliacao do cliente (nota 1 a 5 + comentario) apos o pedido ficar pronto. Arquivo config/avaliacoes.json.
const fs = require('fs');
const path = require('path');

const configDir = process.env.CONFIG_DIR || path.join(__dirname, '..', 'config');
const file = path.join(configDir, 'avaliacoes.json');
const MAX = 5000;

const dia = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

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
    fs.writeFileSync(tmp, JSON.stringify(lista.slice(-MAX)), 'utf8');
    fs.renameSync(tmp, file);
}

// Uma avaliacao por senha/dia
function registrar({ senha, nota, comentario }) {
    const n = parseInt(nota, 10);
    const s = parseInt(senha, 10);
    if (!Number.isInteger(n) || n < 1 || n > 5) throw Object.assign(new Error('A nota deve ser de 1 a 5'), { status: 400 });
    if (!Number.isInteger(s) || s < 0) throw Object.assign(new Error('Senha inválida'), { status: 400 });
    const lista = carregar();
    const d = dia();
    if (lista.some((a) => a.dia === d && a.senha === s)) {
        throw Object.assign(new Error('Este pedido já foi avaliado. Obrigado!'), { status: 409 });
    }
    const texto = String(comentario || '').replace(/[\u0000-\u001f<>]/g, ' ').trim().substring(0, 300);
    lista.push({ dia: d, ts: new Date().toISOString(), senha: s, nota: n, comentario: texto });
    gravar(lista);
}

// Resumo do periodo [inicio, fim] (AAAA-MM-DD)
function resumo(inicio, fim) {
    const itens = carregar().filter((a) => a.dia >= inicio && a.dia <= fim);
    const dist = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    let soma = 0;
    itens.forEach((a) => { dist[a.nota]++; soma += a.nota; });
    return {
        total: itens.length,
        media: itens.length ? Math.round((soma / itens.length) * 100) / 100 : null,
        distribuicao: dist,
        recentes: itens.filter((a) => a.comentario).slice(-8).reverse()
            .map((a) => ({ dia: a.dia, senha: a.senha, nota: a.nota, comentario: a.comentario }))
    };
}

module.exports = { registrar, resumo };
