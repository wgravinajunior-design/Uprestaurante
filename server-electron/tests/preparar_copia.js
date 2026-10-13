// Cria uma cópia do banco para os testes: node tests/preparar_copia.js <origem.FDB> <destino.FDB>
// O destino precisa estar numa pasta que o serviço do Firebird consiga abrir (ex.: C:\\Users\\Public\\fbtest).
const fs = require('fs');
const path = require('path');

const [origem, destino] = process.argv.slice(2);
if (!origem || !destino) {
    console.error('Uso: node tests/preparar_copia.js <origem.FDB> <destino.FDB>');
    process.exit(2);
}
if (/dusuco/i.test(destino)) {
    console.error('RECUSADO: o destino não pode ser o banco de produção.');
    process.exit(2);
}
fs.mkdirSync(path.dirname(destino), { recursive: true });
fs.copyFileSync(origem, destino);
console.log('Cópia criada em ' + destino);
console.log('Agora defina FB_DB_CONN=localhost/3060:' + destino + ' e FB_ALLOW_WRITES=1 e rode: npm test');
