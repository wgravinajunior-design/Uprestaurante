// Atualizacao automatica: consulta as Releases do GitHub (wgravinajunior-design/Uprestaurante)
const { app, dialog } = require('electron');

function setupAutoUpdate(getWindow) {
    if (!app.isPackaged) return; // so no app instalado
    let autoUpdater;
    try { ({ autoUpdater } = require('electron-updater')); } catch (e) { return; }
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.on('error', (e) => console.warn('Atualizacao:', e && e.message));
    autoUpdater.on('update-downloaded', async (info) => {
        const r = await dialog.showMessageBox(getWindow() || undefined, {
            type: 'info',
            buttons: ['Reiniciar agora', 'Depois'],
            defaultId: 0,
            title: 'Atualização disponível',
            message: `A versão ${info.version} foi baixada.`,
            detail: 'Reinicie para concluir a atualização. Se preferir, ela será instalada ao fechar o sistema.'
        });
        if (r.response === 0) autoUpdater.quitAndInstall();
    });
    const check = () => autoUpdater.checkForUpdates().catch(() => {});
    check();
    setInterval(check, 4 * 60 * 60 * 1000);
}

module.exports = { setupAutoUpdate };
