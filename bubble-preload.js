const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('bubbleAPI', {
  onText: (callback) => ipcRenderer.on('bubble-text', (_event, text) => callback(text)),
});
