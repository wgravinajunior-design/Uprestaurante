// Ponte minima e segura entre o processo principal e a UI (contextIsolation ligado).
// O token vem como argumento (--api-token=...) definido em main.js a partir de API_TOKEN.
const { contextBridge, ipcRenderer } = require('electron');

const arg = process.argv.find((a) => a.startsWith('--api-token='));
const apiToken = arg ? arg.substring('--api-token='.length) : '';

contextBridge.exposeInMainWorld('appCfg', {
    apiToken,
    pickDbFile: (current) => ipcRenderer.invoke('pick-db-file', current),
    serviceStatus: () => ipcRenderer.invoke('service-status'),
    serviceInstall: () => ipcRenderer.invoke('service-install'),
    serviceUninstall: () => ipcRenderer.invoke('service-uninstall')
});
