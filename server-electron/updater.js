// Atualizacao automatica: consulta as Releases do GitHub (wgravinajunior-design/Uprestaurante)
const { app, dialog } = require('electron');

let autoUpdater = null;
const estado = { fase: 'ocioso', mensagem: '', versaoNova: '', progresso: 0, verificadoEm: '' };

function setupAutoUpdate(getWindow) {
    if (!app.isPackaged) { estado.mensagem = 'Atualização automática só funciona no aplicativo instalado.'; return; }
    try { ({ autoUpdater } = require('electron-updater')); } catch (e) { estado.mensagem = 'Atualizador indisponível.'; return; }
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.on('checking-for-update', () => { estado.fase = 'verificando'; estado.mensagem = 'Verificando…'; });
    autoUpdater.on('update-available', (i) => { estado.fase = 'baixando'; estado.versaoNova = i.version; estado.mensagem = 'Baixando a versão ' + i.version + '…'; });
    autoUpdater.on('update-not-available', () => { estado.fase = 'atualizado'; estado.mensagem = 'Você está na versão mais recente.'; estado.verificadoEm = new Date().toISOString(); });
    autoUpdater.on('download-progress', (p) => { estado.fase = 'baixando'; estado.progresso = Math.round(p.percent || 0); });
    autoUpdater.on('error', (e) => { estado.fase = 'erro'; estado.mensagem = 'Falha ao verificar: ' + (e && e.message ? e.message : e); });
    autoUpdater.on('update-downloaded', async (info) => {
        estado.fase = 'pronto'; estado.versaoNova = info.version; estado.mensagem = 'Versão ' + info.version + ' pronta para instalar.';
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

function checkNow() {
    if (!autoUpdater) return Promise.resolve({ ...estado });
    return autoUpdater.checkForUpdates().then(() => ({ ...estado })).catch((e) => {
        estado.fase = 'erro'; estado.mensagem = 'Falha ao verificar: ' + (e && e.message ? e.message : e);
        return { ...estado };
    });
}

function installNow() {
    if (autoUpdater && estado.fase === 'pronto') autoUpdater.quitAndInstall();
}

const getState = () => ({ ...estado });

module.exports = { setupAutoUpdate, checkNow, installNow, getState };
