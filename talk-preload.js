const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('talkAPI', {
  send: (text) => ipcRenderer.send('talk-send', text),
  focus: () => ipcRenderer.send('talk-focus'),
  blur: () => ipcRenderer.send('talk-blur'),
});
