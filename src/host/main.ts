import { app, BrowserWindow, dialog, ipcMain, Menu } from 'electron';
import path from 'node:path';
import { ServiceClient } from './service-client';
import { BuildHost } from './build-host';
declare const MAIN_WINDOW_WEBPACK_ENTRY: string;
declare const MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY: string;
let service: ServiceClient;
let window: BrowserWindow;
let quitting = false;
let acceptedClose = false;
let builds: BuildHost;
const methods = new Set(['ping', 'workspace/open', 'workspace/list', 'document/open', 'document/change', 'document/save', 'document/close', 'document/list', 'build/targets', 'diagnostic/open']);

app.whenReady().then(() => {
  const runeRoot = process.env.RUNE_ROOT || '/home/ruud/rune';
  let toolchain = runeRoot;
  const bytecode = app.isPackaged ? path.join(process.resourcesPath, 'service.rbc') : path.join(app.getAppPath(), 'build/service.rbc');
  service = new ServiceClient(path.join(runeRoot, 'bin', process.platform === 'win32' ? 'runevm.exe' : 'runevm'), bytecode);
  builds = new BuildHost(service, app.isPackaged ? path.join(process.resourcesPath, 'compiler.rbc') : path.join(app.getAppPath(), 'build/compiler.rbc'));
  window = new BrowserWindow({ width: 1360, height: 900, minWidth: 760, minHeight: 500, title: 'Rune', backgroundColor: '#171a1f',
    webPreferences: { preload: MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY, contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.on('close', (event) => {
    if (!acceptedClose) { event.preventDefault(); window.webContents.send('rune:command', 'quit'); }
  });
  window.webContents.on('will-navigate', (event, url) => { if (url !== window.webContents.getURL()) event.preventDefault(); });
  service.on('status', (status) => { if (!window.isDestroyed()) window.webContents.send('rune:status', status); });
  builds.on('status', (status) => { if (!window.isDestroyed()) window.webContents.send('rune:build', status); });
  const checkSender = (event: Electron.IpcMainInvokeEvent) => {
    if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) throw new Error('Invalid caller');
  };
  ipcMain.handle('rune:request', async (event, method: unknown, params: unknown) => {
    checkSender(event);
    if (typeof method !== 'string' || !methods.has(method)) throw new Error('Unsupported operation');
    await service.ready;
    const result = await service.request(method, params);
    if (method === 'workspace/open') builds.reset();
    return result;
  });
  ipcMain.handle('rune:choose-folder', async (event) => {
    checkSender(event);
    const result = await dialog.showOpenDialog(window, { properties: ['openDirectory'], title: 'Open workspace' });
    return result.canceled ? null : result.filePaths[0];
  });
  ipcMain.handle('rune:status', (event) => { checkSender(event); return service.status; });
  ipcMain.handle('rune:build-status', event => { checkSender(event); return builds.status; });
  ipcMain.handle('rune:build-start', async (event, params: unknown) => {
    checkSender(event);
    if (!params || typeof params !== 'object' || !('target' in params) || typeof params.target !== 'string') throw new Error('Select a build target');
    const activePath = 'activePath' in params && typeof params.activePath === 'string' ? params.activePath : undefined;
    await builds.start({ target: params.target, activePath }, toolchain);
  });
  ipcMain.handle('rune:build-cancel', event => { checkSender(event); builds.cancel(); });
  ipcMain.handle('rune:toolchain', event => { checkSender(event); return toolchain; });
  ipcMain.handle('rune:choose-toolchain', async event => {
    checkSender(event); if (builds.running) throw new Error('Wait for the active build before changing toolchain');
    const choice = await dialog.showOpenDialog(window, { properties: ['openDirectory'], title: 'Choose Rune toolchain (contains bin/ and lib/)' });
    if (!choice.canceled) toolchain = choice.filePaths[0];
    return toolchain;
  });
  ipcMain.handle('rune:confirm-unsaved', async (event, file: unknown) => {
    checkSender(event);
    if (typeof file !== 'string') throw new Error('Expected document path');
    const result = await dialog.showMessageBox(window, { type: 'question', message: `Save changes to ${path.basename(file)}?`, detail: file, buttons: ['Save', 'Discard', 'Cancel'], defaultId: 0, cancelId: 2, noLink: true });
    return ['save', 'discard', 'cancel'][result.response];
  });
  ipcMain.handle('rune:finish-close', (event) => { checkSender(event); acceptedClose = true; app.quit(); });
  const command = (name: string) => () => window.webContents.send('rune:command', name);
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: 'File', submenu: [
      { label: 'Open Folder…', accelerator: 'CmdOrCtrl+O', click: command('open-folder') },
      { label: 'Save', accelerator: 'CmdOrCtrl+S', click: command('save') },
      { label: 'Save All', accelerator: 'CmdOrCtrl+Shift+S', click: command('save-all') },
      { label: 'Close Editor', accelerator: 'CmdOrCtrl+W', click: command('close') },
      { role: 'quit' },
    ] },
    { role: 'editMenu' },
    { label: 'Build', submenu: [
      { label: 'Save and Build', accelerator: 'CmdOrCtrl+Shift+B', click: command('build') },
      { label: 'Cancel Build', click: command('cancel-build') },
    ] },
    { label: 'View', submenu: [
      { label: 'Split Editor', accelerator: 'CmdOrCtrl+\\', click: command('split') },
      { label: 'Reveal Active File', click: command('reveal') },
      { role: 'toggleDevTools' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' },
    ] },
  ]));
  void window.loadURL(MAIN_WINDOW_WEBPACK_ENTRY);
});
app.on('window-all-closed', () => app.quit());
app.on('before-quit', (event) => {
  if (!acceptedClose && window && !window.isDestroyed()) { event.preventDefault(); window.webContents.send('rune:command', 'quit'); }
  else if (!quitting && service) { event.preventDefault(); quitting = true; void builds.close().finally(() => service.close()).finally(() => app.quit()); }
});
