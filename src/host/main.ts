import { app, BrowserWindow, dialog, ipcMain, Menu } from 'electron';
import path from 'node:path';
import { ServiceClient } from './service-client';
declare const MAIN_WINDOW_WEBPACK_ENTRY: string;
declare const MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY: string;
let service: ServiceClient;
let window: BrowserWindow;
let quitting = false;
const methods = new Set(['ping', 'workspace/open', 'workspace/list']);

app.whenReady().then(() => {
  const runeRoot = process.env.RUNE_ROOT || '/home/ruud/rune';
  const bytecode = app.isPackaged ? path.join(process.resourcesPath, 'service.rbc') : path.join(app.getAppPath(), 'build/service.rbc');
  service = new ServiceClient(path.join(runeRoot, 'bin', process.platform === 'win32' ? 'runevm.exe' : 'runevm'), bytecode);
  window = new BrowserWindow({ width: 1360, height: 900, minWidth: 760, minHeight: 500, title: 'Rune', backgroundColor: '#171a1f',
    webPreferences: { preload: MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY, contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, url) => { if (url !== window.webContents.getURL()) event.preventDefault(); });
  service.on('status', (status) => { if (!window.isDestroyed()) window.webContents.send('rune:status', status); });
  const checkSender = (event: Electron.IpcMainInvokeEvent) => {
    if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) throw new Error('Invalid caller');
  };
  ipcMain.handle('rune:request', async (event, method: unknown, params: unknown) => {
    checkSender(event);
    if (typeof method !== 'string' || !methods.has(method)) throw new Error('Unsupported operation');
    await service.ready;
    return service.request(method, params);
  });
  ipcMain.handle('rune:choose-folder', async (event) => {
    checkSender(event);
    const result = await dialog.showOpenDialog(window, { properties: ['openDirectory'], title: 'Open workspace' });
    return result.canceled ? null : result.filePaths[0];
  });
  ipcMain.handle('rune:status', (event) => { checkSender(event); return service.status; });
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: 'File', submenu: [{ role: 'quit' }] },
    { role: 'editMenu' },
    { label: 'View', submenu: [{ role: 'reload' }, { role: 'toggleDevTools' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }] },
  ]));
  void window.loadURL(MAIN_WINDOW_WEBPACK_ENTRY);
});
app.on('window-all-closed', () => app.quit());
app.on('before-quit', (event) => {
  if (!quitting && service) { event.preventDefault(); quitting = true; void service.close().finally(() => app.quit()); }
});
