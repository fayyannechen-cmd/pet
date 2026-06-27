const { app, BrowserWindow } = require('electron');
const path = require('path');

function createWindow() {
  const win = new BrowserWindow({
    width: 160,
    height: 160,
    transparent: true,   // 背景透明
    frame: false,        // 没有标题栏和边框
    alwaysOnTop: true,   // 浮在桌面最上面
    resizable: false,
    hasShadow: false,    // 透明窗口不要投影
    skipTaskbar: true,
  });

  win.loadFile('index.html');
}

app.whenReady().then(() => {
  createWindow();

  // macOS: 点击 Dock 图标且没有窗口时，重新创建一个
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// 桌宠场景下，关掉窗口就退出
app.on('window-all-closed', () => {
  app.quit();
});
