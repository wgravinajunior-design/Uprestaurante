// Ponte minima e segura entre o processo principal e a UI (contextIsolation ligado).
// O token vem como argumento (--api-token=...) definido em main.js a partir de API_TOKEN.
const { contextBridge } = require('electron');

const arg = process.argv.find((a) => a.startsWith('--api-token='));
const apiToken = arg ? arg.substring('--api-token='.length) : '';

contextBridge.exposeInMainWorld('appCfg', { apiToken });
