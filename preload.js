const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('petAPI', {
  // 主进程 -> 画面：现在该播哪个动作、朝哪个方向
  onState: (callback) => {
    ipcRenderer.on('pet-state', (_event, state) => callback(state));
  },

  // 画面 -> 主进程：
  // 鼠标是否落在狗身体上（true=身体，关闭穿透；false=透明，开启穿透）
  setOverBody: (overBody) => ipcRenderer.send('set-over-body', overBody),
  // 开始/结束拖动
  startDrag: () => ipcRenderer.send('start-drag'),
  endDrag: () => ipcRenderer.send('end-drag'),
});
