const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('bubbleAPI', {
  // 静态文字（打招呼用）
  onText: (callback) => ipcRenderer.on('bubble-text', (_event, text) => callback(text)),
  // 流式回复（贴身聊天用）
  onReset: (callback) => ipcRenderer.on('bubble-reset', () => callback()),
  onChunk: (callback) => ipcRenderer.on('bubble-chunk', (_event, delta) => callback(delta)),
  onDone: (callback) => ipcRenderer.on('bubble-done', () => callback()),
  onError: (callback) => ipcRenderer.on('bubble-error', (_event, msg) => callback(msg)),
  // 打字机把字吐完后通知主进程（用于决定何时收起气泡、恢复走动）
  typed: () => ipcRenderer.send('bubble-typed'),
});
