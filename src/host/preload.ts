import { contextBridge, ipcRenderer } from 'electron';
import { RuneBridge, ServiceStatus } from '../shared/protocol';
const bridge: RuneBridge = {
  request: (method, params = {}) => ipcRenderer.invoke('rune:request', method, params),
  chooseFolder: () => ipcRenderer.invoke('rune:choose-folder'),
  status: () => ipcRenderer.invoke('rune:status'),
  onStatus: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, status: ServiceStatus) => listener(status);
    ipcRenderer.on('rune:status', handler);
    return () => ipcRenderer.removeListener('rune:status', handler);
  },
};
contextBridge.exposeInMainWorld('rune', bridge);
