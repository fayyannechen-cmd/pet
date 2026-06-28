const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('memoAPI', {
  get: () => ipcRenderer.invoke('memo-get'),
  add: (text) => ipcRenderer.send('memo-add', text),
  del: (id) => ipcRenderer.send('memo-del', id),
  onList: (callback) => ipcRenderer.on('memo-list', (_event, list) => callback(list)),
  close: () => ipcRenderer.send('memo-close'),
});
