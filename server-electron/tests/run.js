// Executa a suíte de integração (grava na cópia de teste). Veja tests/README.md.
const { spawnSync } = require('child_process');
const path = require('path');

let falhou = false;
for (const arq of ['escrita.test.js', 'http.test.js', 'agenda.test.js']) {
    console.log('\n=== ' + arq + ' ===');
    const r = spawnSync(process.execPath, [path.join(__dirname, arq)], { stdio: 'inherit', env: process.env });
    if (r.status !== 0) falhou = true;
}
process.exit(falhou ? 1 : 0);
