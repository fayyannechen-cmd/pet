const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('chatAPI', {
  send: (text) => ipcRenderer.send('chat-message', text),
  onReply: (callback) => ipcRenderer.on('chat-reply', (_event, text) => callback(text)),
  close: () => ipcRenderer.send('chat-close'),
});
