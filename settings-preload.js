const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('settingsAPI', {
  get: () => ipcRenderer.invoke('get-config'),
  save: (cfg) => ipcRenderer.send('save-config', cfg),
  test: (cfg) => ipcRenderer.invoke('test-connection', cfg),
  close: () => ipcRenderer.send('settings-close'),
});
