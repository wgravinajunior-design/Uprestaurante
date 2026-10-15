// Copia o build do Flutter Web para server-electron/web (embutido no instalador)
const fs = require('fs');
const path = require('path');
const src = path.join(__dirname, '..', '..', 'flutter_web', 'build', 'web');
const dst = path.join(__dirname, '..', 'web');
if (!fs.existsSync(path.join(src, 'index.html'))) {
    console.error('Build do Flutter nao encontrado em', src, '- rode: flutter build web');
    process.exit(1);
}
fs.rmSync(dst, { recursive: true, force: true });
fs.cpSync(src, dst, { recursive: true });
console.log('Flutter web copiado para', dst);
