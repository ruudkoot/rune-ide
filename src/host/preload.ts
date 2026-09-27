import { contextBridge, ipcRenderer } from 'electron';
import { BuildStatus, Command, RuneBridge, ServiceStatus } from '../shared/protocol';
const bridge: RuneBridge = {
  request: (method, params = {}) => ipcRenderer.invoke('rune:request', method, params),
  zoom: direction => ipcRenderer.invoke('rune:zoom', direction),
  chooseFolder: () => ipcRenderer.invoke('rune:choose-folder'),
  status: () => ipcRenderer.invoke('rune:status'),
  confirmUnsaved: (path) => ipcRenderer.invoke('rune:confirm-unsaved', path),
  finishClose: () => ipcRenderer.invoke('rune:finish-close'),
  buildStart: params => ipcRenderer.invoke('rune:build-start', params),
  buildCancel: () => ipcRenderer.invoke('rune:build-cancel'),
  buildStatus: () => ipcRenderer.invoke('rune:build-status'),
  toolchain: () => ipcRenderer.invoke('rune:toolchain'),
  chooseToolchain: () => ipcRenderer.invoke('rune:choose-toolchain'),
  restartService: () => ipcRenderer.invoke('rune:restart-service'),
  watch: (paths, showExcluded) => ipcRenderer.invoke('rune:watch', { paths, showExcluded }),
  onFilesChanged: listener => {
    ipcRenderer.on('rune:files-changed', listener);
    return () => ipcRenderer.removeListener('rune:files-changed', listener);
  },
  onBuild: listener => {
    const handler = (_event: Electron.IpcRendererEvent, status: BuildStatus) => listener(status);
    ipcRenderer.on('rune:build', handler);
    return () => ipcRenderer.removeListener('rune:build', handler);
  },
  onCommand: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, command: Command) => listener(command);
    ipcRenderer.on('rune:command', handler);
    return () => ipcRenderer.removeListener('rune:command', handler);
  },
  onStatus: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, status: ServiceStatus) => listener(status);
    ipcRenderer.on('rune:status', handler);
    return () => ipcRenderer.removeListener('rune:status', handler);
  },
};
contextBridge.exposeInMainWorld('rune', bridge);
