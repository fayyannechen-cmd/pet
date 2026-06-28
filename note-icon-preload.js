const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('noteAPI', {
  open: () => ipcRenderer.send('open-memo'),
});
