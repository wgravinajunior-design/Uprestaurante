// Roda a suite de integracao contra uma COPIA descartavel do banco (nunca grava na producao).
// Usado por "npm run release": se algum teste falhar, a publicacao e abortada.
// SKIP_TESTS=1 pula (use so em emergencia). FBTEST_DIR muda a pasta da copia.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

if (process.env.SKIP_TESTS === '1') {
    console.warn('SKIP_TESTS=1: testes ignorados.');
    process.exit(0);
}

const cfgDir = process.env.CONFIG_DIR || path.join(__dirname, '..', 'config');
let origem = process.env.FB_SOURCE_DB || '';
if (!origem) {
    try {
        const j = JSON.parse(fs.readFileSync(path.join(cfgDir, 'db.json'), 'utf8'));
        const m = String(j.dbConn || '').match(/^[^:]*(?:\/\d+)?:(.+)$/); // host/porta:C:\caminho\DADOS.FDB
        origem = m ? m[1] : '';
    } catch (e) { /* sem config */ }
}
if (!origem || !fs.existsSync(origem)) {
    console.error('Banco de origem nao encontrado (' + (origem || 'db.json ausente') + ').');
    console.error('Defina FB_SOURCE_DB=<caminho do DADOS.FDB> ou SKIP_TESTS=1.');
    process.exit(1);
}

const dir = process.env.FBTEST_DIR || path.join(process.env.PUBLIC || 'C:\\Users\\Public', 'fbtest');
const destino = path.join(dir, 'DADOS.FDB');
fs.mkdirSync(dir, { recursive: true });
try { fs.rmSync(destino, { force: true }); } catch (e) { /* segue */ }
const t0 = Date.now();
// o arquivo pode estar momentaneamente travado (outra conexao/sincronizacao): tenta de novo
for (let i = 1; ; i++) {
    try { fs.copyFileSync(origem, destino); break; } catch (e) {
        if (i >= 6 || !/EBUSY|EPERM|EACCES/.test(String(e.code))) throw e;
        console.log('Arquivo em uso, tentando de novo (' + i + '/5)...');
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 3000);
    }
}
console.log(`Copia de teste criada (${Math.round((Date.now() - t0) / 1000)}s): ${destino}`);

const port = (String((() => { try { return JSON.parse(fs.readFileSync(path.join(cfgDir, 'db.json'), 'utf8')).dbConn; } catch (e) { return ''; } })()).match(/\/(\d+):/) || [])[1] || '3050';
const env = { ...process.env, FB_DB_CONN: `localhost/${port}:${destino}`, FB_ALLOW_WRITES: '1' };
const r = spawnSync(process.execPath, [path.join(__dirname, '..', 'tests', 'run.js')], { stdio: 'inherit', env });
try { fs.rmSync(destino, { force: true }); } catch (e) { /* ignora */ }
if (r.status !== 0) {
    console.error('\nTESTES FALHARAM: publicacao abortada.');
    process.exit(1);
}
console.log('\nTestes OK.');
