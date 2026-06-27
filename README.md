<div align="center">

<img src="assets/little-mao-puppy/frames/wave/01.png" width="120" alt="小狗" />

# Desk Pet · 桌面宠物小狗

一只悬浮在 macOS 桌面上、会走动、能拖拽、还能用 AI 跟你聊天的桌面宠物。

![Platform](https://img.shields.io/badge/platform-macOS-black)
![Electron](https://img.shields.io/badge/Electron-31-47848F?logo=electron&logoColor=white)
![Made with](https://img.shields.io/badge/made%20with-HTML%2FCSS%2FJS-f7df1e)
![License](https://img.shields.io/badge/license-MIT-green)

</div>

## 简介

Desk Pet 是一个基于 [Electron](https://www.electronjs.org/) 的桌面宠物应用。一只名叫「小狗」的像素角色会透明悬浮在你的桌面最上层：平时原地待机做小动作，时不时自己走来走去；你可以用鼠标把它拖到任意位置，右键唤出原生菜单，还能打开一个 iMessage 风格的聊天窗口，接入真实大模型与它对话——回复以打字机效果逐字呈现。

整个项目用原生 HTML / CSS / JavaScript 编写，**没有任何前端框架、没有构建步骤**，结构清晰，适合作为 Electron 多窗口应用的学习范例。

## 功能特性

- 🐶 **透明悬浮窗** —— 无边框、背景透明、始终置顶，像素图保持锐利不模糊
- 🎞️ **逐帧动画** —— 待机、走路等多组动作循环播放，预加载无闪烁
- 🚶 **自动走动** —— 随机向左右走动一段后自动走回原位，边界自动夹取不越屏
- 🖱️ **像素级拖拽** —— 仅点在身体上才能拖动，点击透明区域穿透到桌面
- 🍎 **原生右键菜单** —— 系统原生样式，含打招呼 / 聊天 / 暂停 / 设置 / 退出
- 💬 **AI 聊天** —— 兼容 OpenRouter 的流式对话，回复打字机逐字显示
- 💭 **说话气泡** —— 「打招呼」时头顶弹出气泡，并实时跟随桌宠移动
- ⚙️ **可视化设置面板** —— 填写 API Key（带显示切换）、下拉选择模型、测试连接

## 技术栈

| 类别 | 选型 |
| --- | --- |
| 桌面框架 | Electron 31 |
| 界面 | 原生 HTML / CSS / JavaScript（无框架、无打包） |
| 进程通信 | `contextBridge` + `ipcMain` / `ipcRenderer`（每个窗口独立 preload） |
| AI 接口 | OpenRouter（OpenAI 兼容的 `/chat/completions`，SSE 流式） |
| 运行环境 | Node.js 18+ / macOS |

## 快速开始

> 需要本机已安装 [Node.js](https://nodejs.org/) 18 及以上版本。

```bash
# 1. 克隆项目
git clone https://github.com/fayyannechen-cmd/pet.git
cd pet

# 2. 安装依赖（会下载 Electron）
npm install

# 3. 启动
npm start
```

启动后小狗会出现在屏幕底部。**右键点它的身体**即可唤出菜单。

> 💡 若你从 VS Code 的集成终端启动遇到 `Cannot read properties of undefined (reading 'whenReady')`，是因为继承了 `ELECTRON_RUN_AS_NODE=1` 环境变量。换用系统自带的「终端」启动，或先执行 `unset ELECTRON_RUN_AS_NODE` 即可。

## 配置 AI 聊天

本项目**不使用环境变量**，所有配置通过设置面板写入本地配置文件。

### 在应用内配置（推荐）

右键小狗 → **设置…**，填写三项后点「保存」：

| 字段 | 说明 | 默认值 |
| --- | --- | --- |
| API Key | OpenRouter 的密钥（`sk-or-...`），密码框可切换显示 | 空 |
| 模型 | 下拉选择常用模型，或选「自定义」手填任意模型 ID | `deepseek/deepseek-v4-pro` |
| 接口地址 | OpenAI 兼容的 Base URL | `https://openrouter.ai/api/v1` |

点「测试连接」可校验 Key 是否有效；未填 Key 时聊天会提示先去配置。

### 配置文件位置

保存后写入用户数据目录（**位于 Git 仓库之外，不会被提交**）：

```
~/Library/Application Support/desk-pet/config.json
```

```json
{
  "baseURL": "https://openrouter.ai/api/v1",
  "apiKey": "sk-or-...",
  "model": "deepseek/deepseek-v4-pro"
}
```

> 🔒 **安全**：`config.json` 含 API Key，已在 `.gitignore` 中忽略，绝不会进入版本库。

## 项目结构

```
pet/
├── main.js              # 主进程：窗口管理、行为循环、拖拽、菜单、配置读写、AI 流式请求
├── index.html           # 桌宠窗口：逐帧动画、像素级点击检测、拖拽与右键触发
├── preload.js           # 桌宠窗口的 IPC 桥
├── bubble.html          # 「打招呼」气泡窗口
├── bubble-preload.js
├── chat.html            # 聊天窗口：iMessage 风格 UI + 打字机效果
├── chat-preload.js
├── settings.html        # 设置面板：API Key / 模型 / 接口地址 / 测试连接
├── settings-preload.js
├── assets/
│   └── little-mao-puppy/ # 角色素材
│       ├── frames/       # 逐帧动画：walk / scratch / roll / cheer / wave / expressions
│       ├── spritesheet.webp
│       └── pet.json
├── package.json
└── run.sh               # 便捷启动脚本
```

## 工作原理

- **走路 = 移动窗口**：桌宠窗口只有 160×160，所谓「走动」是主进程逐步移动整个窗口位置，渲染层同步播放走路帧并按方向左右翻转。
- **点击穿透 + 拖拽**：窗口默认 `setIgnoreMouseEvents(true, { forward: true })` 让点击落到桌面；渲染层把当前帧画到离屏 canvas 逐像素读取透明度，判断鼠标是否压在身体上，再临时接管鼠标。读像素需要同源，故对桌宠窗口开启 `webSecurity: false`（仅加载本地素材，安全）。
- **AI 流式回复**：主进程用 `fetch` 以 SSE 方式请求接口，逐段下发 token；渲染层维护一个字符队列，按固定节奏逐字吐出，形成稳定的打字机效果，与网络分块无关。

## 自定义

部分手感参数可直接在源码中调整：

| 参数 | 位置 | 含义 |
| --- | --- | --- |
| `randomBetween(3000, 7000)` | `main.js` | 待机时长区间（毫秒） |
| `randomBetween(120, 320)` | `main.js` | 单次走动距离区间（像素） |
| `walkTo(target)` 的 `speed` | `main.js` | 走动速度（每步像素） |
| `CLIPS.*.fps` | `index.html` | 各动作的播放帧率 |
| 打字机间隔 `18` | `chat.html` | 每个字出现的间隔（毫秒） |

## 路线图

- [ ] 打包为 `.app` 并支持开机自启
- [ ] 聊天时桌宠联动动画（如挥手、欢呼）
- [ ] 更多动作触发（`cheer` / `roll` / `wave` / `tearful` 已有素材）
- [ ] 多角色 / 皮肤切换

## 致谢

角色素材「Little Mao Puppy（小鸡毛）」by Hao Y.

## License

[MIT](LICENSE)
