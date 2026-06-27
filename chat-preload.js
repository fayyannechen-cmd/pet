const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('chatAPI', {
  // 把整段对话历史发给主进程
  send: (messages) => ipcRenderer.send('chat-message', messages),
  // 流式接收：{type:'chunk',text} / {type:'done'} / {type:'error',message,needConfig}
  onStream: (callback) => ipcRenderer.on('chat-stream', (_event, ev) => callback(ev)),
  openSettings: () => ipcRenderer.send('open-settings'),
  close: () => ipcRenderer.send('chat-close'),
});
