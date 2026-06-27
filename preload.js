const { contextBridge, ipcRenderer } = require('electron');

// 主进程 -> 画面 的唯一通道：主进程决定现在该播放哪个动作、朝哪个方向，
// 画面只负责把它播出来。
contextBridge.exposeInMainWorld('petAPI', {
  onState: (callback) => {
    ipcRenderer.on('pet-state', (_event, state) => callback(state));
  },
});
