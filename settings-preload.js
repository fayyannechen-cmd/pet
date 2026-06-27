const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('settingsAPI', {
  get: () => ipcRenderer.invoke('get-config'),
  save: (cfg) => ipcRenderer.send('save-config', cfg),
  close: () => ipcRenderer.send('settings-close'),
});
