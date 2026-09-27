import { app, BrowserWindow, dialog, ipcMain, Menu } from 'electron';
import path from 'node:path';
import { mkdirSync } from 'node:fs';
import { ServiceClient } from './service-client';
import { BuildHost } from './build-host';
import { WorkspaceWatcher } from './workspace-watcher';
declare const MAIN_WINDOW_WEBPACK_ENTRY: string;
declare const MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY: string;
let service: ServiceClient;
let window: BrowserWindow;
let quitting = false;
let acceptedClose = false;
let builds: BuildHost;
let watcher: WorkspaceWatcher;
const methods = new Set(['ping', 'workspace/open', 'workspace/list', 'workspace/changes', 'file/create', 'file/copy', 'file/rename', 'file/delete', 'document/open', 'document/change', 'document/check', 'document/reload', 'document/save', 'document/close', 'document/list', 'document/attach', 'build/targets', 'diagnostic/open', 'session/load', 'session/save', 'recovery/restore', 'recovery/discard']);
if (process.env.RUNE_IDE_USER_DATA) {
  const userData = path.resolve(process.env.RUNE_IDE_USER_DATA);
  mkdirSync(userData, { recursive: true, mode: 0o700 });
  app.setPath('userData', userData);
}
const primaryInstance = app.requestSingleInstanceLock();
if (!primaryInstance) app.quit();
app.on('second-instance', () => { if (window && !window.isDestroyed()) { if (window.isMinimized()) window.restore(); window.focus(); } });

if (primaryInstance) app.whenReady().then(() => {
  const runeRoot = process.env.RUNE_ROOT || '/home/ruud/rune';
  let toolchain = runeRoot;
  const bytecode = app.isPackaged ? path.join(process.resourcesPath, 'service.rbc') : path.join(app.getAppPath(), 'build/service.rbc');
  const vm = path.join(runeRoot, 'bin', process.platform === 'win32' ? 'runevm.exe' : 'runevm');
  mkdirSync(app.getPath('userData'), { recursive: true, mode: 0o700 });
  const stateDir = path.join(app.getPath('userData'), 'ide-state');
  const compiler = app.isPackaged ? path.join(process.resourcesPath, 'compiler.rbc') : path.join(app.getAppPath(), 'build/compiler.rbc');
  const connect = () => {
    service = new ServiceClient(vm, bytecode, stateDir);
    builds = new BuildHost(service, compiler);
    service.on('status', status => {
      if (status.state === 'failed') builds.cancel();
      if (window && !window.isDestroyed()) window.webContents.send('rune:status', status);
    });
    builds.on('status', status => { if (window && !window.isDestroyed()) window.webContents.send('rune:build', status); });
  };
  connect();
  watcher = new WorkspaceWatcher(() => { if (!window.isDestroyed()) window.webContents.send('rune:files-changed'); });
  const backgroundTest = process.env.RUNE_IDE_TEST_BACKGROUND === '1';
  window = new BrowserWindow({ width: 1360, height: 900, minWidth: 760, minHeight: 500, title: 'Rune', backgroundColor: '#171a1f',
    show: !backgroundTest,
    webPreferences: { preload: MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY, contextIsolation: true, nodeIntegration: false, sandbox: true,
      backgroundThrottling: !backgroundTest, offscreen: backgroundTest },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.on('close', (event) => {
    if (!acceptedClose) { event.preventDefault(); window.webContents.send('rune:command', 'quit'); }
  });
  window.webContents.on('will-navigate', (event, url) => { if (url !== window.webContents.getURL()) event.preventDefault(); });
  const checkSender = (event: Electron.IpcMainInvokeEvent) => {
    if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) throw new Error('Invalid caller');
  };
  ipcMain.handle('rune:request', async (event, method: unknown, params: unknown) => {
    checkSender(event);
    if (typeof method !== 'string' || !methods.has(method)) throw new Error('Unsupported operation');
    await service.ready;
    const result = await service.request(method, params);
    if (method === 'workspace/open') { builds.reset(); watcher.configure([]); }
    return result;
  });
  ipcMain.handle('rune:watch', async (event, params: unknown) => {
    checkSender(event); await service.ready;
    watcher.configure(await service.request('workspace/watch', params) as string[]);
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
  ipcMain.handle('rune:toolchain', async event => {
    checkSender(event); await service.ready;
    const session = await service.request('session/load') as { settings: { toolchain?: string } };
    toolchain = session.settings.toolchain || toolchain;
    return toolchain;
  });
  ipcMain.handle('rune:choose-toolchain', async event => {
    checkSender(event); if (builds.running) throw new Error('Wait for the active build before changing toolchain');
    const choice = await dialog.showOpenDialog(window, { properties: ['openDirectory'], title: 'Choose Rune toolchain (contains bin/ and lib/)' });
    if (!choice.canceled) { toolchain = choice.filePaths[0]; await service.request('session/toolchain', { path: toolchain }); }
    return toolchain;
  });
  let restarting = false;
  ipcMain.handle('rune:restart-service', async event => {
    checkSender(event);
    if (restarting || builds.running) throw new Error('Finish or cancel the build before restarting the service');
    restarting = true;
    try {
      watcher.configure([]);
      await builds.close(); await service.close(); service.removeAllListeners(); builds.removeAllListeners();
      connect(); window.webContents.send('rune:status', service.status);
      await service.ready;
      window.webContents.send('rune:build', builds.status);
    } finally { restarting = false; }
  });
  ipcMain.handle('rune:confirm-unsaved', async (event, file: unknown) => {
    checkSender(event);
    if (typeof file !== 'string') throw new Error('Expected document path');
    const result = await dialog.showMessageBox(window, { type: 'question', message: `Save changes to ${path.basename(file)}?`, detail: file, buttons: ['Save', 'Discard', 'Cancel'], defaultId: 0, cancelId: 2, noLink: true });
    return ['save', 'discard', 'cancel'][result.response];
  });
  ipcMain.handle('rune:finish-close', async (event) => {
    checkSender(event);
    if (service.status.state === 'ready') await service.request('session/end');
    acceptedClose = true; app.quit();
  });
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
  else if (!quitting && service) { event.preventDefault(); quitting = true; watcher?.close(); void builds.close().finally(() => service.close()).finally(() => app.quit()); }
});
