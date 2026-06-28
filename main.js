const { app, BrowserWindow, screen, ipcMain, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');

// 桌宠窗口尺寸（改这里即可整体等比缩放）
const PET = 120;
const HALF = PET / 2;

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

// ---- 备忘录存储（同样在用户数据目录，不进 Git）----
function memosPath() {
  return path.join(app.getPath('userData'), 'memos.json');
}
function loadMemos() {
  try {
    const list = JSON.parse(fs.readFileSync(memosPath(), 'utf8'));
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}
function saveMemos(list) {
  fs.writeFileSync(memosPath(), JSON.stringify(list, null, 2));
}
function addMemo(text) {
  const list = loadMemos();
  list.unshift({ id: Date.now(), text, time: Date.now() });
  saveMemos(list);
  return list;
}
function deleteMemo(id) {
  const list = loadMemos().filter((m) => m.id !== id);
  saveMemos(list);
  return list;
}
// 备忘录窗口若开着，推送最新列表
function pushMemoList() {
  if (memoWin && !memoWin.isDestroyed()) memoWin.webContents.send('memo-list', loadMemos());
}

// 从聊天文字里解析「添加到备忘录 xxx」，返回要记的内容；不是该指令则返回 null
const MEMO_TRIGGER = '添加到备忘录';
function extractMemo(text) {
  const i = (text || '').indexOf(MEMO_TRIGGER);
  if (i === -1) return null;
  return text.slice(i + MEMO_TRIGGER.length).replace(/^[\s:：,，、.。!！~～-]+/, '').trim();
}

// ---- 聊天关键词触发宠物动作 ----
const ACTION_KEYWORDS = [
  { clip: 'wave',       repeat: 2, ms: 1600, words: ['挥手', '打招呼', '你好', 'hi', 'hello', 'wave'] },
  { clip: 'cheer',      repeat: 2, ms: 1500, words: ['欢呼', '庆祝', '加油', '耶', 'cheer', '棒'] },
  { clip: 'roll',       repeat: 2, ms: 2400, words: ['打滚', '滚一个', '转圈', 'roll'] },
  { clip: 'idle',       repeat: 2, ms: 1600, words: ['挠痒', '挠挠', 'scratch'] },
  { clip: 'expression', repeat: 2, ms: 2000, words: ['难过', '伤心', '委屈', '哭', 'cry'] },
];
function matchAction(text) {
  return ACTION_KEYWORDS.find((a) => a.words.some((w) => text.includes(w))) || null;
}
const ACTION_HELP = '我会这些动作哦～🐾\n挥手 / 欢呼 / 打滚 / 挠痒 / 难过\n直接打字就能让我做';

// ---- 当前运行的任务（前台程序）----
function run(cmd, args) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: 3000 }, (err, stdout) => resolve(err ? '' : stdout));
  });
}
// 取当前前台程序名（无需任何系统授权）
async function frontApp() {
  const asn = (await run('/usr/bin/lsappinfo', ['front'])).trim();
  if (!asn) return '';
  const info = await run('/usr/bin/lsappinfo', ['info', '-only', 'name', asn]);
  const m = info.match(/="([^"]*)"/);   // 形如 "LSDisplayName"="Code"
  return m ? m[1] : '';
}

// 每隔几秒看一眼前台任务，变了就自动在气泡里提示（不打断其它气泡 / 不打断走动）
let lastTask = '';
async function checkTask() {
  if (!win || win.isDestroyed()) return;
  const name = await frontApp();
  if (!name || /electron|desk-?pet/i.test(name)) return;   // 忽略宠物自己
  if (name === lastTask) return;
  lastTask = name;
  if (dragging || paused || emoting || talking || replying) return;  // 别盖掉聊天等气泡
  sayInBubble(`🏃「${name}」运行中～`, 8000);
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

let noteIconWin = null;          // 宠物右上角的粉色笔记本图标
let noteIconFollowTimer = null;
let memoWin = null;              // 备忘录窗口

let talkWin = null;              // 宠物下方的快捷输入条
let talkFollowTimer = null;
let talking = false;             // 正在聊天（聚焦输入或等回复）时停下走动
let talkFocused = false;
let replying = false;
let replyLinger = 6000;          // 回复打完后气泡停留多久（按长短动态调整）
const talkHistory = [];          // 贴身聊天的对话历史

function updateTalking() {
  talking = talkFocused || replying;
}

function createWindow() {
  win = new BrowserWindow({
    width: PET,
    height: PET,
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
    x: Math.round(work.x + work.width / 2 - HALF),
    y: Math.round(work.y + work.height - PET - 60),
  };
  win.setPosition(startPos.x, startPos.y);

  win.loadFile('index.html');
  win.webContents.on('did-finish-load', behaviorLoop);

  createTalkBar();   // 宠物下方的快捷输入条
  createNoteIcon();  // 宠物右上角的备忘录图标

  setInterval(checkTask, 5000);   // 每 5 秒看一眼前台任务，变了就自动提示
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
    { label: '聊天…', click: openChat },
    { label: '📝 备忘录', click: openMemo },
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

// ---- 桌宠头顶气泡窗口（打招呼 + 贴身聊天回复共用）----
const BUBBLE_W = 200;
const BUBBLE_H = 140;

function ensureBubble() {
  if (bubbleWin && !bubbleWin.isDestroyed()) return;
  bubbleWin = new BrowserWindow({
    width: BUBBLE_W,
    height: BUBBLE_H,
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

// 给气泡发消息（窗口还在加载就等加载完）
function bubbleSend(channel, payload) {
  if (!bubbleWin || bubbleWin.isDestroyed()) return;
  const wc = bubbleWin.webContents;
  if (wc.isLoading()) wc.once('did-finish-load', () => wc.send(channel, payload));
  else wc.send(channel, payload);
}

// 把气泡摆到桌宠正上方（气泡底部贴近头顶）
function positionBubble() {
  if (!win || win.isDestroyed() || !bubbleWin || bubbleWin.isDestroyed()) return;
  const [px, py] = win.getPosition();
  bubbleWin.setPosition(Math.round(px + HALF - BUBBLE_W / 2), Math.round(py + 12 - BUBBLE_H));
}

function startBubbleFollow() {
  positionBubble();
  if (bubbleFollowTimer) clearInterval(bubbleFollowTimer);
  bubbleFollowTimer = setInterval(positionBubble, 16);
}

function hideBubble() {
  if (bubbleFollowTimer) { clearInterval(bubbleFollowTimer); bubbleFollowTimer = null; }
  if (bubbleWin && !bubbleWin.isDestroyed()) bubbleWin.hide();
}

function showGreeting(text) {
  if (!win || win.isDestroyed()) return;
  ensureBubble();
  bubbleSend('bubble-text', text);
  bubbleWin.showInactive();
  startBubbleFollow();
  if (bubbleTimer) clearTimeout(bubbleTimer);
  bubbleTimer = setTimeout(hideBubble, 2500);
}

function sendState(state) {
  if (win && !win.isDestroyed()) {
    win.webContents.send('pet-state', state);
  }
}

// ---- 宠物下方的快捷输入条 ----
const TALK_W = 190;
const TALK_H = 48;

function positionTalk() {
  if (!win || win.isDestroyed() || !talkWin || talkWin.isDestroyed()) return;
  const [px, py] = win.getPosition();
  talkWin.setPosition(Math.round(px + HALF - TALK_W / 2), Math.round(py + PET - 8));
}

function createTalkBar() {
  talkWin = new BrowserWindow({
    width: TALK_W,
    height: TALK_H,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    resizable: false,
    hasShadow: false,
    skipTaskbar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'talk-preload.js'),
    },
  });
  talkWin.loadFile('talk.html');
  talkWin.once('ready-to-show', () => {
    positionTalk();
    talkWin.showInactive();      // 显示但不抢焦点
  });
  if (talkFollowTimer) clearInterval(talkFollowTimer);
  talkFollowTimer = setInterval(positionTalk, 16);   // 始终跟随宠物
}

// ---- 宠物右上角的粉色笔记本图标 ----
const ICON_W = 32;
const ICON_H = 36;

function positionNoteIcon() {
  if (!win || win.isDestroyed() || !noteIconWin || noteIconWin.isDestroyed()) return;
  const [px, py] = win.getPosition();
  // 放在宠物右侧外缘，不和宠物身体重叠
  noteIconWin.setPosition(Math.round(px + PET - 2), Math.round(py + 6));
}

function createNoteIcon() {
  noteIconWin = new BrowserWindow({
    width: ICON_W,
    height: ICON_H,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    resizable: false,
    hasShadow: false,
    skipTaskbar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'note-icon-preload.js'),
    },
  });
  noteIconWin.loadFile('note-icon.html');
  noteIconWin.once('ready-to-show', () => {
    positionNoteIcon();
    noteIconWin.showInactive();
  });
  if (noteIconFollowTimer) clearInterval(noteIconFollowTimer);
  noteIconFollowTimer = setInterval(positionNoteIcon, 16);
}

// ---- 备忘录窗口（双击图标 / 右键菜单打开，置顶在屏幕左上角）----
function openMemo() {
  if (memoWin && !memoWin.isDestroyed()) {
    memoWin.show();
    memoWin.focus();
    return;
  }
  const work = screen.getPrimaryDisplay().workArea;
  memoWin = new BrowserWindow({
    width: 320,
    height: 440,
    x: work.x + 24,
    y: work.y + 24,
    frame: false,
    transparent: true,
    alwaysOnTop: true,           // 置顶
    resizable: true,
    minWidth: 260,
    minHeight: 320,
    hasShadow: true,
    webPreferences: {
      preload: path.join(__dirname, 'memo-preload.js'),
    },
  });
  memoWin.loadFile('memo.html');
}

// 在头顶气泡里说一句话（复用打字机 + 停留逻辑）；linger 可指定停留时长
function sayInBubble(text, linger) {
  ensureBubble();
  bubbleSend('bubble-reset');
  bubbleWin.showInactive();
  startBubbleFollow();
  if (bubbleTimer) clearTimeout(bubbleTimer);
  replyLinger = linger || Math.min(15000, Math.max(5000, text.length * 90));
  bubbleSend('bubble-chunk', text);
  bubbleSend('bubble-done');
}

// 让宠物做一个动作（播放 repeat 次后自动恢复）
function playAction(a) {
  if (!win || win.isDestroyed() || dragging) return;
  emoting = true;
  sendState({ clip: a.clip, repeat: a.repeat, facing: 1 });
  if (emoteTimer) clearTimeout(emoteTimer);
  emoteTimer = setTimeout(() => { emoting = false; emoteTimer = null; }, a.ms);
}

// 贴身聊天：把 AI 回复以流式打字机显示在头顶气泡里
async function streamChatToBubble(messages) {
  ensureBubble();
  bubbleSend('bubble-reset');
  bubbleWin.showInactive();
  startBubbleFollow();
  if (bubbleTimer) clearTimeout(bubbleTimer);   // 取消打招呼的自动收起

  const cfg = loadConfig();
  if (!cfg.apiKey) {
    replyLinger = 7000;
    bubbleSend('bubble-error', '先点右键「设置」填一下 API Key 哦～');
    return;
  }

  try {
    const url = cfg.baseURL.replace(/\/+$/, '') + '/chat/completions';
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${cfg.apiKey}`,
        'HTTP-Referer': 'https://desk-pet.local',
        'X-Title': 'Desk Pet',
      },
      body: JSON.stringify({
        model: cfg.model,
        messages: [SYSTEM_PROMPT, ...messages],
        stream: true,
        max_tokens: 150,        // 贴身气泡，回复简短一点
      }),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      bubbleSend('bubble-error', `出错了(${res.status})：${detail.slice(0, 120)}`);
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let full = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;
        const data = trimmed.slice(5).trim();
        if (data === '[DONE]') continue;
        try {
          const delta = JSON.parse(data).choices?.[0]?.delta?.content;
          if (delta) { full += delta; bubbleSend('bubble-chunk', delta); }
        } catch { /* 半个 JSON，忽略 */ }
      }
    }
    if (full) talkHistory.push({ role: 'assistant', content: full });
    // 回复越长留得越久：至少 5 秒，每个字 +90ms，最多 15 秒
    replyLinger = Math.min(15000, Math.max(5000, full.length * 90));
    bubbleSend('bubble-done');
  } catch (err) {
    replyLinger = 7000;
    bubbleSend('bubble-error', `呜…网络出错了：${err.message || err}`);
  }
}

const randomBetween = (min, max) => min + Math.random() * (max - min);

// 待机动作：随机挠痒 / 欢呼 / 打滚 / 挥手，让站着时更有生气
const idleClip = () => {
  const r = Math.random();
  if (r < 0.20) return 'cheer';
  if (r < 0.40) return 'roll';
  if (r < 0.55) return 'wave';
  return 'idle';
};

// 可被拖动/暂停打断的等待
function sleep(ms) {
  return new Promise((resolve) => {
    let elapsed = 0;
    const step = 100;
    const timer = setInterval(() => {
      if (!win || win.isDestroyed() || dragging || paused || emoting || talking) {
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
      if (!win || win.isDestroyed() || dragging || paused || emoting || talking) {
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
  const maxX = work.x + work.width - PET;

  while (win && !win.isDestroyed()) {
    if (dragging) { await waitUntil(() => !dragging); continue; }
    if (paused)   { await waitUntil(() => !paused);   continue; }
    if (emoting)  { await waitUntil(() => !emoting);  continue; }
    if (talking)  { await waitUntil(() => !talking);  continue; }

    sendState({ clip: idleClip() });
    await sleep(randomBetween(3000, 7000));
    if (dragging || paused || emoting || talking) continue;

    const dir = Math.random() < 0.5 ? -1 : 1;
    const distance = randomBetween(120, 320);
    let target = Math.round(Math.max(minX, Math.min(maxX, startPos.x + dir * distance)));

    sendState({ clip: 'walk', facing: target >= startPos.x ? 1 : -1 });
    await walkTo(target);
    if (dragging || paused || emoting || talking) continue;

    sendState({ clip: idleClip() });
    await sleep(randomBetween(800, 1600));
    if (dragging || paused || emoting || talking) continue;

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
  // 「添加到备忘录 xxx」：直接记录，不走 AI
  const last = messages[messages.length - 1]?.content || '';
  const note = extractMemo(last);
  if (note !== null) {
    const reply = note
      ? `已添加到备忘录📝：${note}`
      : '要记点什么呢？在「添加到备忘录」后面写上内容～';
    if (note) { addMemo(note); pushMemoList(); }
    event.sender.send('chat-stream', { type: 'chunk', text: reply });
    event.sender.send('chat-stream', { type: 'done' });
    return;
  }

  // 列出会的动作
  if (/你会什么|会做什么|会什么|动作列表|有什么动作|会哪些/.test(last)) {
    event.sender.send('chat-stream', { type: 'chunk', text: ACTION_HELP });
    event.sender.send('chat-stream', { type: 'done' });
    return;
  }

  // 关键词触发动作
  const action = matchAction(last);
  if (action) {
    playAction(action);
    event.sender.send('chat-stream', { type: 'chunk', text: '好呀～🐾' });
    event.sender.send('chat-stream', { type: 'done' });
    return;
  }

  streamChat(event.sender, messages);
});

ipcMain.on('chat-close', () => {
  if (chatWin && !chatWin.isDestroyed()) chatWin.hide();
});

// ---- 宠物下方快捷输入条 ----
ipcMain.on('talk-focus', () => {
  talkFocused = true;
  updateTalking();
  sendState({ clip: 'idle' });   // 站好听你说话
});

ipcMain.on('talk-blur', () => {
  talkFocused = false;
  updateTalking();
});

ipcMain.on('talk-send', (_event, text) => {
  const t = (text || '').trim();
  if (!t || !win || win.isDestroyed()) return;

  // 「添加到备忘录 xxx」：直接记录，不走 AI
  const note = extractMemo(t);
  if (note !== null) {
    replying = true;
    updateTalking();
    sendState({ clip: 'idle' });
    if (note) {
      addMemo(note);
      pushMemoList();
      sayInBubble(`好嘞，已记到备忘录📝：${note}`);
    } else {
      sayInBubble('要记点什么呢？在「添加到备忘录」后面写上内容～');
    }
    return;
  }

  // 「你会什么 / 动作」：列出会的动作
  if (/你会什么|会做什么|会什么|动作列表|有什么动作|会哪些/.test(t)) {
    replying = true;
    updateTalking();
    sendState({ clip: 'idle' });
    sayInBubble(ACTION_HELP, 9000);
    return;
  }

  // 关键词触发动作（不走 AI）
  const action = matchAction(t);
  if (action) {
    playAction(action);
    return;
  }

  talkHistory.push({ role: 'user', content: t });
  replying = true;
  updateTalking();
  sendState({ clip: 'idle' });
  streamChatToBubble(talkHistory);
});

// ---- 备忘录 ----
ipcMain.on('open-memo', openMemo);                 // 双击粉色笔记本图标
ipcMain.handle('memo-get', () => loadMemos());
ipcMain.on('memo-add', (_e, text) => {
  const t = (text || '').trim();
  if (t) { addMemo(t); pushMemoList(); }
});
ipcMain.on('memo-del', (_e, id) => { deleteMemo(id); pushMemoList(); });
ipcMain.on('memo-close', () => {
  if (memoWin && !memoWin.isDestroyed()) memoWin.hide();
});

// 气泡把字吐完后：停留一会儿再收起，并恢复走动
ipcMain.on('bubble-typed', () => {
  if (bubbleTimer) clearTimeout(bubbleTimer);
  bubbleTimer = setTimeout(() => {
    hideBubble();
    replying = false;
    updateTalking();
  }, replyLinger);
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
