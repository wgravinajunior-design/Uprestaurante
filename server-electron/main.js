const { app, BrowserWindow, shell } = require('electron');
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
