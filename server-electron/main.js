const { app, BrowserWindow, shell, dialog, ipcMain } = require('electron');
const path = require('path');
const fs0 = require('fs');

// Instalado: config/cache em %APPDATA% (a pasta do app e somente leitura e e trocada a cada atualizacao)
if (app.isPackaged) {
    const dataDir = app.getPath('userData');
    process.env.CONFIG_DIR = process.env.CONFIG_DIR || path.join(dataDir, 'config');
    process.env.CACHE_DIR = process.env.CACHE_DIR || path.join(dataDir, 'cache');
    fs0.mkdirSync(process.env.CONFIG_DIR, { recursive: true });
    const seed = path.join(__dirname, 'config', 'db.example.json');
    const dst = path.join(process.env.CONFIG_DIR, 'db.json');
    if (!fs0.existsSync(dst) && fs0.existsSync(seed)) fs0.copyFileSync(seed, dst);
}
const portsCfg = require('./server/ports');
const { startServer, logEvent } = require('./server/index');
const { setupAutoUpdate, checkNow, installNow, getState } = require('./updater');

let mainWindow;
let serverInstance;
let tvServerInstance;
let ordersServerInstance;
let publicServerInstance;

async function createWindow() {
    // Start Express REST API & static file servers (Main: 8080, TV: 8081, Orders: 8082)
    try {
        const p = portsCfg.get();
        const res = await startServer(p.api, p.tv, p.orders);
        serverInstance = res.server;
        tvServerInstance = res.tvServer;
        ordersServerInstance = res.ordersServer;
        publicServerInstance = res.publicServer;
    } catch (e) {
        console.error('Erro ao iniciar servidores:', e);
    }

    mainWindow = new BrowserWindow({
        width: 1100,
        height: 720,
        minWidth: 900,
        minHeight: 600,
        backgroundColor: '#0b1120',
        title: 'DUSUCO ERP - Servidor Firebird 5 & Flutter Web',
        webPreferences: {
            // A UI so faz fetch para a API local; nao precisa de Node no renderer
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: true,
            preload: path.join(__dirname, 'preload.js'),
            additionalArguments: [`--api-token=${process.env.API_TOKEN || ''}`, `--ports=${JSON.stringify(portsCfg.get())}`]
        }
    });

    mainWindow.loadFile(path.join(__dirname, 'ui', 'index.html'));

    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        shell.openExternal(url);
        return { action: 'deny' };
    });

    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}

// --- Servico do Windows (tarefa de inicializacao como SYSTEM), instalado com elevacao (UAC) ---
const { execFile } = require('child_process');
const fs = require('fs');
const SERVICE_TASK = 'DusucoERP-Servidor';
const SVC_DIR = path.join(__dirname, 'service').replace('app.asar', 'app.asar.unpacked');
const SERVICE_SCRIPT = path.join(SVC_DIR, 'service-admin.ps1');
const SERVICE_LOG = path.join(app.getPath('temp'), 'uprestaurante-service-last.log');

function serviceStatus() {
    return new Promise((resolve) => {
        execFile('schtasks.exe', ['/Query', '/TN', SERVICE_TASK, '/FO', 'LIST'], { windowsHide: true }, (err, out) => {
            if (err) return resolve({ installed: false, running: false });
            resolve({ installed: true, running: /Running|Em execu/i.test(out) });
        });
    });
}

function runElevated(action) {
    return new Promise((resolve) => {
        try { fs.rmSync(SERVICE_LOG, { force: true }); } catch (e) { /* ignora */ }
        const inner = `-NoProfile -ExecutionPolicy Bypass -File "${SERVICE_SCRIPT}" -Action ${action} -LogFile "${SERVICE_LOG}" -DataDir "${process.env.CONFIG_DIR ? path.dirname(process.env.CONFIG_DIR) : ''}" -AppExe "${process.execPath}" -Packaged ${app.isPackaged ? 1 : 0}`;
        const cmd = `Start-Process powershell -Verb RunAs -Wait -WindowStyle Hidden -ArgumentList '${inner.replace(/'/g, "''")}'`;
        execFile('powershell.exe', ['-NoProfile', '-Command', cmd], { windowsHide: true }, async (err) => {
            if (err) return resolve({ ok: false, message: 'Permissão de administrador negada ou cancelada' });
            let log = '';
            try { log = fs.readFileSync(SERVICE_LOG, 'utf8').trim(); } catch (e) { /* ignora */ }
            const st = await serviceStatus();
            const ok = log.startsWith('OK');
            resolve({ ok, message: log || 'Sem retorno do instalador', ...st });
        });
    });
}

ipcMain.handle('update-info', () => ({
    version: app.getVersion(),
    packaged: app.isPackaged,
    state: getState(),
    logsDir: require('./server/filelog').dir()
}));
ipcMain.handle('update-check', () => checkNow());
ipcMain.handle('update-install', () => { installNow(); return getState(); });
ipcMain.handle('open-logs', async () => {
    const d = require('./server/filelog').dir();
    try { fs0.mkdirSync(d, { recursive: true }); } catch (e) { /* ignora */ }
    return shell.openPath(d);
});
ipcMain.handle('ports-get', () => ({ current: portsCfg.get(), defaults: portsCfg.DEFAULTS }));
ipcMain.handle('ports-save', (_e, input) => {
    try {
        portsCfg.save(input);
        setTimeout(() => { app.relaunch(); app.exit(0); }, 400);
        return { ok: true };
    } catch (e) { return { ok: false, message: e.message }; }
});
ipcMain.handle('service-status', () => serviceStatus());
ipcMain.handle('service-install', () => runElevated('install'));
ipcMain.handle('service-uninstall', () => runElevated('uninstall'));

// Seletor de arquivo da base (.FDB) para a tela de configuracao
ipcMain.handle('pick-db-file', async (_e, current) => {
    const r = await dialog.showOpenDialog(mainWindow, {
        title: 'Selecionar base de dados',
        defaultPath: current || undefined,
        properties: ['openFile'],
        filters: [{ name: 'Firebird', extensions: ['fdb', 'gdb'] }, { name: 'Todos', extensions: ['*'] }]
    });
    return r.canceled ? null : r.filePaths[0];
});

app.whenReady().then(async () => {
    await createWindow();
    setupAutoUpdate(() => mainWindow);
});

app.on('window-all-closed', () => {
    if (serverInstance) {
        serverInstance.close();
    }
    if (tvServerInstance) {
        tvServerInstance.close();
    }
    if (ordersServerInstance) {
        ordersServerInstance.close();
    }
    if (publicServerInstance) {
        publicServerInstance.close();
    }
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
    }
});
