// Ponte minima e segura entre o processo principal e a UI (contextIsolation ligado).
// O token vem como argumento (--api-token=...) definido em main.js a partir de API_TOKEN.
const { contextBridge, ipcRenderer } = require('electron');

const arg = process.argv.find((a) => a.startsWith('--api-token='));
const apiToken = arg ? arg.substring('--api-token='.length) : '';

const portsArg = process.argv.find((a) => a.startsWith('--ports='));
let ports = { api: 8080, tv: 8081, orders: 8082, public: 8083, kds: 8084, senhas: 8085 };
try { if (portsArg) ports = JSON.parse(portsArg.substring('--ports='.length)); } catch (e) { /* padrao */ }

contextBridge.exposeInMainWorld('appCfg', {
    apiToken,
    ports,
    portsSave: (p) => ipcRenderer.invoke('ports-save', p),
    updateInfo: () => ipcRenderer.invoke('update-info'),
    updateCheck: () => ipcRenderer.invoke('update-check'),
    updateInstall: () => ipcRenderer.invoke('update-install'),
    openLogs: () => ipcRenderer.invoke('open-logs'),
    pickDbFile: (current) => ipcRenderer.invoke('pick-db-file', current),
    serviceStatus: () => ipcRenderer.invoke('service-status'),
    serviceInstall: () => ipcRenderer.invoke('service-install'),
    serviceUninstall: () => ipcRenderer.invoke('service-uninstall')
});
