const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('bridge', Object.freeze({
  invoke: (method, args) => ipcRenderer.invoke('bridge:invoke', method, args),
}));
