// Garante bin/cloudflared.exe (embutido no instalador): copia do PC ou baixa do GitHub oficial
const fs = require('fs');
const path = require('path');
const dst = path.join(__dirname, '..', 'bin', 'cloudflared.exe');
fs.mkdirSync(path.dirname(dst), { recursive: true });
if (fs.existsSync(dst)) process.exit(0);
const local = ['C:\Program Files (x86)\cloudflared\cloudflared.exe', 'C:\Program Files\cloudflared\cloudflared.exe'].find((p) => fs.existsSync(p));
if (local) { fs.copyFileSync(local, dst); console.log('cloudflared copiado de', local); process.exit(0); }
fetch('https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe')
    .then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.arrayBuffer(); })
    .then((b) => { fs.writeFileSync(dst, Buffer.from(b)); console.log('cloudflared baixado'); })
    .catch((e) => { console.error('Falha ao obter cloudflared:', e.message); process.exit(1); });
