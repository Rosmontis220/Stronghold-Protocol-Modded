const { app, BrowserWindow, shell, dialog } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

let localServer;
let mainWindow;

function bundledRoot() {
  return app.isPackaged ? path.join(process.resourcesPath, 'app.asar') : path.resolve(__dirname, '..');
}

async function startLocalServer() {
  const root = bundledRoot();
  const { startServer } = await import(pathToFileURL(path.join(root, 'server', 'index.js')).href);
  localServer = await startServer({
    host: '127.0.0.1',
    port: 0,
    quiet: true,
    publicDir: path.join(root, 'public'),
    dataDir: path.join(root, 'data'),
    sharedDir: path.join(root, 'shared'),
    notice: false,
  });
  return localServer.url;
}

function configuredGameServer() {
  return process.env.STRONGHOLD_SERVER || 'https://wsxy.rosmontis220.top';
}

async function createWindow() {
  const localUrl = await startLocalServer();
  const target = `${localUrl}/?server=${encodeURIComponent(configuredGameServer())}`;
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    backgroundColor: '#090d16',
    title: 'Stronghold Protocol: Alliance',
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  await mainWindow.loadURL(target);
  if (process.env.STRONGHOLD_DEVTOOLS === '1') mainWindow.webContents.openDevTools();
}

app.whenReady().then(async () => {
  try {
    await createWindow();
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
  } catch (error) {
    console.error('[desktop] failed to start', error);
    await dialog.showMessageBox({ type: 'error', title: 'Stronghold Protocol', message: '客户端启动失败', detail: String(error?.stack || error) });
    app.quit();
  }
});

app.on('window-all-closed', async () => {
  try { await localServer?.close(); } catch { /* ignore */ }
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', async () => {
  try { await localServer?.close(); } catch { /* ignore */ }
});
