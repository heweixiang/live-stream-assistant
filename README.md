# 直播助手

抖音直播桌面助手架子：查看弹幕/礼物，按规则触发整蛊动作。

## 技术栈

- **桌面端**：Electron + Vue3 + TypeScript + Vite
- **弹幕核心**：Python（本地 WebSocket 推送；当前默认 Mock 模式）
- **规则引擎**：关键词 / 礼物金额 → 音效 / 弹窗 / TTS（占位）

## 快速开始

### 1. 启动本地服务（默认待命，不自动连直播间）

```bash
cd core
pip install -r requirements.txt
python server.py
```

### 2. 启动桌面端

```bash
cd app
npm install
npm run electron:dev
```

## 目录结构

```
直播助手/
├── app/                 # Electron + Vue 桌面端
│   ├── electron/        # 主进程 / preload
│   └── src/             # 渲染进程 UI
├── core/                # Python 弹幕服务
│   ├── fetcher/         # 采集（mock / 真实接入预留）
│   └── server.py        # 本地 WS 服务
├── rules/               # 默认整蛊规则
└── actions/             # 动作说明 / 资源占位
```

## 当前能力

- [x] Mock 弹幕 / 礼物 / 进场实时推送
- [x] 填写直播号连接真实抖音直播间（网页版协议，非官方开放平台）
- [x] 弹幕墙 + 礼物列表
- [x] 规则配置（关键词、礼物门槛）
- [x] 命中规则后桌面通知 / 状态栏提示
- [ ] OBS WebSocket 联动
- [ ] 本地音效 / TTS 实装

## 连接自己的直播间

1. 电脑浏览器打开：`https://live.douyin.com/你的直播号`
2. 把 URL 里 `/` 后面的数字填进桌面端「直播号」
3. 选择「抖音」→ 点「连接」（需要正在开播）

说明：这是网页版弹幕长连接，不是抖音开放平台官方接口；抖音改协议时可能失效。仅建议用于自己的直播间自用工具。
