const { app, BrowserWindow, shell, dialog, ipcMain } = require('electron');
const path = require('path');
const { startServer, logEvent } = require('./server/index');

let mainWindow;
let serverInstance;
let tvServerInstance;
let ordersServerInstance;
let publicServerInstance;

async function createWindow() {
    // Start Express REST API & static file servers (Main: 8080, TV: 8081, Orders: 8082)
    try {
        const res = await startServer(8080, 8081, 8082);
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
            additionalArguments: [`--api-token=${process.env.API_TOKEN || ''}`]
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
const SERVICE_SCRIPT = path.join(__dirname, 'service', 'service-admin.ps1');
const SERVICE_LOG = path.join(__dirname, 'service', 'service-last.log');

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
        const inner = `-NoProfile -ExecutionPolicy Bypass -File "${SERVICE_SCRIPT}" -Action ${action}`;
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

app.whenReady().then(createWindow);

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
