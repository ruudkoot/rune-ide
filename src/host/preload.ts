import { contextBridge, ipcRenderer } from 'electron';
import { Command, RuneBridge, ServiceStatus } from '../shared/protocol';
const bridge: RuneBridge = {
  request: (method, params = {}) => ipcRenderer.invoke('rune:request', method, params),
  chooseFolder: () => ipcRenderer.invoke('rune:choose-folder'),
  status: () => ipcRenderer.invoke('rune:status'),
  confirmUnsaved: (path) => ipcRenderer.invoke('rune:confirm-unsaved', path),
  finishClose: () => ipcRenderer.invoke('rune:finish-close'),
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
