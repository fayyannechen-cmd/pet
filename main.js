const { app, BrowserWindow, screen } = require('electron');
const path = require('path');

let win;
let startPos = { x: 0, y: 0 };   // 桌宠的"家"，走完要回到这里

function createWindow() {
  win = new BrowserWindow({
    width: 160,
    height: 160,
    transparent: true,   // 背景透明
    frame: false,        // 没有标题栏和边框
    alwaysOnTop: true,   // 浮在桌面最上面
    resizable: false,
    hasShadow: false,    // 透明窗口不要投影
    skipTaskbar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  // 把家安在屏幕底部偏中间
  const work = screen.getPrimaryDisplay().workArea;
  startPos = {
    x: Math.round(work.x + work.width / 2 - 80),
    y: Math.round(work.y + work.height - 160 - 60),
  };
  win.setPosition(startPos.x, startPos.y);

  win.loadFile('index.html');

  // 画面加载完成后再开始"大脑"循环，确保指令能被收到
  win.webContents.on('did-finish-load', behaviorLoop);
}

// 给画面发指令：现在播哪个动作、朝哪个方向（facing: 1=朝右, -1=朝左）
function sendState(state) {
  if (win && !win.isDestroyed()) {
    win.webContents.send('pet-state', state);
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const randomBetween = (min, max) => min + Math.random() * (max - min);

// 把窗口平滑地移动到 targetX（一步一步挪，看起来像在走）
function walkTo(targetX, speed = 2, stepMs = 16) {
  return new Promise((resolve) => {
    const timer = setInterval(() => {
      if (!win || win.isDestroyed()) {
        clearInterval(timer);
        return resolve();
      }
      const [x, y] = win.getPosition();
      if (Math.abs(targetX - x) <= speed) {
        win.setPosition(targetX, y);   // 到了，吸附到目标点
        clearInterval(timer);
        return resolve();
      }
      const dir = targetX > x ? 1 : -1;
      win.setPosition(x + dir * speed, y);
    }, stepMs);
  });
}

// 桌宠的行为循环：待机 -> 随机往一边走 -> 走回家 -> 继续待机
async function behaviorLoop() {
  const work = screen.getPrimaryDisplay().workArea;
  const minX = work.x;                       // 别走出屏幕左边
  const maxX = work.x + work.width - 160;     // 别走出屏幕右边

  while (win && !win.isDestroyed()) {
    // 1) 原地待机一会儿
    sendState({ clip: 'idle' });
    await sleep(randomBetween(3000, 7000));
    if (!win || win.isDestroyed()) break;

    // 2) 随机选方向和距离，算出目标点（并夹在屏幕范围内）
    const dir = Math.random() < 0.5 ? -1 : 1;      // -1 往左, 1 往右
    const distance = randomBetween(120, 320);
    let target = startPos.x + dir * distance;
    target = Math.round(Math.max(minX, Math.min(maxX, target)));

    // 3) 朝目标方向走过去
    sendState({ clip: 'walk', facing: target >= startPos.x ? 1 : -1 });
    await walkTo(target);
    if (!win || win.isDestroyed()) break;

    // 4) 到了之后停一下喘口气
    sendState({ clip: 'idle' });
    await sleep(randomBetween(800, 1600));
    if (!win || win.isDestroyed()) break;

    // 5) 走回家（脸朝回家的方向）
    sendState({ clip: 'walk', facing: startPos.x >= target ? 1 : -1 });
    await walkTo(startPos.x);
  }
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  app.quit();
});
