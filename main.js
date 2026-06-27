const { app, BrowserWindow, screen, ipcMain, Menu } = require('electron');
const path = require('path');
const fs = require('fs');

// ---- 本地配置（存在用户数据目录，在 Git 仓库之外，绝不会被提交）----
const DEFAULT_CONFIG = {
  baseURL: 'https://openrouter.ai/api/v1',
  apiKey: '',
  model: 'deepseek/deepseek-v4-pro',
};
function configPath() {
  return path.join(app.getPath('userData'), 'config.json');
}
function loadConfig() {
  try {
    return { ...DEFAULT_CONFIG, ...JSON.parse(fs.readFileSync(configPath(), 'utf8')) };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}
function saveConfig(partial) {
  const merged = { ...loadConfig(), ...partial };
  fs.writeFileSync(configPath(), JSON.stringify(merged, null, 2));
  return merged;
}

let win;
let startPos = { x: 0, y: 0 };   // 桌宠的"家"，走完要回到这里
let dragging = false;            // 是否正在被拖动（拖动时暂停自动走路）
let paused = false;              // 是否被手动暂停（动画 + 走路都冻结）
let emoting = false;             // 是否正在播放双击触发的表情（期间停下走动）
let emoteTimer = null;
let dragOffset = { x: 0, y: 0 }; // 鼠标点和窗口左上角的固定偏移
let dragTimer = null;

let bubbleWin = null;            // "打招呼"用的气泡窗口
let bubbleTimer = null;
let bubbleFollowTimer = null;    // 让气泡持续跟随桌宠
let chatWin = null;              // 聊天窗口
let settingsWin = null;          // 设置窗口

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
      // 关闭同源限制，让画面能读取本地图片的像素（用于判断鼠标是否点在身体上）。
      // 只加载项目内的本地素材，没有远程内容，安全。
      webSecurity: false,
    },
  });

  // 默认让鼠标穿透窗口（点击直接落到桌面），但仍转发鼠标移动事件给画面，
  // 这样画面才能知道鼠标移到了身体上，再临时关闭穿透。
  win.setIgnoreMouseEvents(true, { forward: true });

  // 把家安在屏幕底部偏中间
  const work = screen.getPrimaryDisplay().workArea;
  startPos = {
    x: Math.round(work.x + work.width / 2 - 80),
    y: Math.round(work.y + work.height - 160 - 60),
  };
  win.setPosition(startPos.x, startPos.y);

  win.loadFile('index.html');
  win.webContents.on('did-finish-load', behaviorLoop);
}

// 冻结/恢复（动画交给画面，走路在 behaviorLoop 里）
function setPaused(p) {
  paused = p;
  sendState({ paused: p });
}

// ---- 右键原生菜单 ----
function popupMenu() {
  if (!win || win.isDestroyed()) return;
  const menu = Menu.buildFromTemplate([
    { label: '打招呼', click: () => showGreeting('你好鸭～❤️') },
    { label: '聊天…', click: openChat },
    { label: '设置…', click: openSettings },
    { label: paused ? '继续' : '暂停', click: () => setPaused(!paused) },
    { type: 'separator' },
    { label: '退出', click: () => app.quit() },
  ]);
  menu.popup({ window: win });
}

// ---- 聊天窗口 ----
function openChat() {
  if (chatWin && !chatWin.isDestroyed()) {
    chatWin.show();
    chatWin.focus();
    return;
  }
  chatWin = new BrowserWindow({
    width: 360,
    height: 520,
    minWidth: 300,
    minHeight: 380,
    frame: false,
    transparent: true,
    resizable: true,
    hasShadow: true,
    skipTaskbar: false,
    webPreferences: {
      preload: path.join(__dirname, 'chat-preload.js'),
    },
  });
  chatWin.loadFile('chat.html');
}

// ---- 设置窗口 ----
function openSettings() {
  if (settingsWin && !settingsWin.isDestroyed()) {
    settingsWin.show();
    settingsWin.focus();
    return;
  }
  settingsWin = new BrowserWindow({
    width: 420,
    height: 460,
    frame: false,
    transparent: true,
    resizable: false,
    hasShadow: true,
    webPreferences: {
      preload: path.join(__dirname, 'settings-preload.js'),
    },
  });
  settingsWin.loadFile('settings.html');
}

// ---- "打招呼"气泡窗口 ----
function ensureBubble() {
  if (bubbleWin && !bubbleWin.isDestroyed()) return;
  bubbleWin = new BrowserWindow({
    width: 220,
    height: 90,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    resizable: false,
    hasShadow: false,
    skipTaskbar: true,
    focusable: false,            // 不抢焦点
    webPreferences: {
      preload: path.join(__dirname, 'bubble-preload.js'),
    },
  });
  bubbleWin.setIgnoreMouseEvents(true);   // 气泡不挡鼠标
  bubbleWin.loadFile('bubble.html');
}

// 把气泡摆到桌宠正上方
function positionBubble() {
  if (!win || win.isDestroyed() || !bubbleWin || bubbleWin.isDestroyed()) return;
  const [px, py] = win.getPosition();
  const bw = 220;
  bubbleWin.setPosition(Math.round(px + 80 - bw / 2), Math.round(py - 30));
}

function showGreeting(text) {
  if (!win || win.isDestroyed()) return;
  ensureBubble();
  positionBubble();

  const send = () => bubbleWin.webContents.send('bubble-text', text);
  if (bubbleWin.webContents.isLoading()) {
    bubbleWin.webContents.once('did-finish-load', send);
  } else {
    send();
  }
  bubbleWin.showInactive();      // 显示但不抢焦点

  // 显示期间持续跟随桌宠移动
  if (bubbleFollowTimer) clearInterval(bubbleFollowTimer);
  bubbleFollowTimer = setInterval(positionBubble, 16);

  if (bubbleTimer) clearTimeout(bubbleTimer);
  bubbleTimer = setTimeout(() => {
    if (bubbleFollowTimer) { clearInterval(bubbleFollowTimer); bubbleFollowTimer = null; }
    if (bubbleWin && !bubbleWin.isDestroyed()) bubbleWin.hide();
  }, 2500);
}

function sendState(state) {
  if (win && !win.isDestroyed()) {
    win.webContents.send('pet-state', state);
  }
}

const randomBetween = (min, max) => min + Math.random() * (max - min);

// 可被拖动/暂停打断的等待
function sleep(ms) {
  return new Promise((resolve) => {
    let elapsed = 0;
    const step = 100;
    const timer = setInterval(() => {
      if (!win || win.isDestroyed() || dragging || paused || emoting) {
        clearInterval(timer);
        return resolve();
      }
      elapsed += step;
      if (elapsed >= ms) {
        clearInterval(timer);
        resolve();
      }
    }, step);
  });
}

function waitUntil(predicate) {
  return new Promise((resolve) => {
    const timer = setInterval(() => {
      if (!win || win.isDestroyed() || predicate()) {
        clearInterval(timer);
        resolve();
      }
    }, 100);
  });
}

// 把窗口平滑移动到 targetX；被拖动或暂停时立刻中止
function walkTo(targetX, speed = 2, stepMs = 16) {
  return new Promise((resolve) => {
    const timer = setInterval(() => {
      if (!win || win.isDestroyed() || dragging || paused || emoting) {
        clearInterval(timer);
        return resolve();
      }
      const [x, y] = win.getPosition();
      if (Math.abs(targetX - x) <= speed) {
        win.setPosition(targetX, y);
        clearInterval(timer);
        return resolve();
      }
      const dir = targetX > x ? 1 : -1;
      win.setPosition(x + dir * speed, y);
    }, stepMs);
  });
}

// 行为循环：待机 -> 随机往一边走 -> 走回家 -> 继续待机；任何时候被拖动都会重置循环
async function behaviorLoop() {
  const work = screen.getPrimaryDisplay().workArea;
  const minX = work.x;
  const maxX = work.x + work.width - 160;

  while (win && !win.isDestroyed()) {
    if (dragging) { await waitUntil(() => !dragging); continue; }
    if (paused)   { await waitUntil(() => !paused);   continue; }
    if (emoting)  { await waitUntil(() => !emoting);  continue; }

    sendState({ clip: 'idle' });
    await sleep(randomBetween(3000, 7000));
    if (dragging || paused || emoting) continue;

    const dir = Math.random() < 0.5 ? -1 : 1;
    const distance = randomBetween(120, 320);
    let target = Math.round(Math.max(minX, Math.min(maxX, startPos.x + dir * distance)));

    sendState({ clip: 'walk', facing: target >= startPos.x ? 1 : -1 });
    await walkTo(target);
    if (dragging || paused || emoting) continue;

    sendState({ clip: 'idle' });
    await sleep(randomBetween(800, 1600));
    if (dragging || paused || emoting) continue;

    sendState({ clip: 'walk', facing: startPos.x >= target ? 1 : -1 });
    await walkTo(startPos.x);
  }
}

// ---- 鼠标穿透：鼠标在身体上就接管，在透明区就穿透到桌面 ----
ipcMain.on('set-over-body', (_event, overBody) => {
  if (!win || win.isDestroyed() || dragging) return;  // 拖动中不切换
  win.setIgnoreMouseEvents(!overBody, { forward: true });
});

// ---- 右键菜单 ----
ipcMain.on('open-menu', popupMenu);

// ---- 双击：停下来播一次表情，结束后恢复走动 ----
ipcMain.on('play-expression', () => {
  if (!win || win.isDestroyed() || dragging || paused) return;
  emoting = true;
  sendState({ clip: 'expression', repeat: 3, facing: 1 });   // 表情播 3 次
  if (emoteTimer) clearTimeout(emoteTimer);
  // 单次约 0.8s（4 帧 @ 5fps），播 3 次 ≈ 2.4s，留点余量再恢复
  emoteTimer = setTimeout(() => { emoting = false; emoteTimer = null; }, 2700);
});

// ---- 聊天：把消息发给 OpenRouter，流式接收 AI 回复 ----
const SYSTEM_PROMPT = {
  role: 'system',
  content: '你是一只名叫"小狗"的桌面宠物，性格活泼亲切。回复简短口语化，可以偶尔用"汪"，用中文回答。',
};

function streamSend(sender, payload) {
  if (sender && !sender.isDestroyed()) sender.send('chat-stream', payload);
}

async function streamChat(sender, messages) {
  const cfg = loadConfig();
  if (!cfg.apiKey) {
    streamSend(sender, { type: 'error', needConfig: true, message: '还没有配置 API Key，请先在「设置」里填写。' });
    return;
  }

  try {
    const url = cfg.baseURL.replace(/\/+$/, '') + '/chat/completions';
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${cfg.apiKey}`,
        'HTTP-Referer': 'https://desk-pet.local',   // OpenRouter 可选，用于统计
        'X-Title': 'Desk Pet',
      },
      body: JSON.stringify({
        model: cfg.model,
        messages: [SYSTEM_PROMPT, ...messages],
        stream: true,
      }),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      streamSend(sender, { type: 'error', message: `接口出错 ${res.status}：${detail.slice(0, 200)}` });
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split('\n');
      buffer = lines.pop();   // 最后一段可能不完整，留到下一轮
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;   // 跳过注释/心跳行
        const data = trimmed.slice(5).trim();
        if (data === '[DONE]') continue;
        try {
          const json = JSON.parse(data);
          const delta = json.choices?.[0]?.delta?.content;
          if (delta) streamSend(sender, { type: 'chunk', text: delta });
        } catch {
          /* 不完整的 JSON 片段，忽略 */
        }
      }
    }
    streamSend(sender, { type: 'done' });
  } catch (err) {
    streamSend(sender, { type: 'error', message: `请求失败：${err.message || err}` });
  }
}

ipcMain.on('chat-message', (event, messages) => {
  streamChat(event.sender, messages);
});

ipcMain.on('chat-close', () => {
  if (chatWin && !chatWin.isDestroyed()) chatWin.hide();
});

// ---- 设置 ----
ipcMain.handle('get-config', () => loadConfig());
ipcMain.on('save-config', (_event, cfg) => { saveConfig(cfg); });
ipcMain.on('open-settings', openSettings);

// 「测试连接」：用表单里当前的值，向接口要一下模型列表，验证 Key 是否有效
ipcMain.handle('test-connection', async (_event, cfg) => {
  if (!cfg.apiKey) return { ok: false, message: '请先填写 API Key' };
  if (!cfg.baseURL) return { ok: false, message: '请先填写接口地址' };
  try {
    const url = cfg.baseURL.replace(/\/+$/, '') + '/models';
    const res = await fetch(url, { headers: { 'Authorization': `Bearer ${cfg.apiKey}` } });
    if (res.ok) return { ok: true, message: '连接成功 ✓' };
    if (res.status === 401 || res.status === 403) return { ok: false, message: `API Key 无效（${res.status}）` };
    return { ok: false, message: `接口返回 ${res.status}` };
  } catch (err) {
    return { ok: false, message: `无法连接：${err.message || err}` };
  }
});
ipcMain.on('settings-close', () => {
  if (settingsWin && !settingsWin.isDestroyed()) settingsWin.hide();
});

// ---- 拖动 ----
ipcMain.on('start-drag', () => {
  if (!win || win.isDestroyed()) return;
  dragging = true;
  sendState({ clip: 'idle' });

  const cursor = screen.getCursorScreenPoint();
  const [wx, wy] = win.getPosition();
  dragOffset = { x: cursor.x - wx, y: cursor.y - wy };

  if (dragTimer) clearInterval(dragTimer);
  dragTimer = setInterval(() => {
    if (!win || win.isDestroyed()) { clearInterval(dragTimer); return; }
    const c = screen.getCursorScreenPoint();
    win.setPosition(c.x - dragOffset.x, c.y - dragOffset.y);
  }, 16);
});

ipcMain.on('end-drag', () => {
  if (dragTimer) { clearInterval(dragTimer); dragTimer = null; }
  if (win && !win.isDestroyed()) {
    const [wx, wy] = win.getPosition();
    startPos = { x: wx, y: wy };   // 松手处变成新家
  }
  dragging = false;
});

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  app.quit();
});
