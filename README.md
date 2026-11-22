# 直播助手 (Live Stream Assistant)

<div align="center">

**抖音直播桌面助手：实时弹幕/礼物监控 + 智能整蛊规则引擎**

[![License](https://img.shields.io/badge/license-CC%20BY--NC--SA%204.0-blue.svg)](LICENSE)
[![Version](https://img.shields.io/badge/version-0.1.0--beta.14-green.svg)](https://github.com/touchfish/live-stream-assistant)
[![Electron](https://img.shields.io/badge/Electron-37.2-47848F.svg)](https://www.electronjs.org/)
[![Vue](https://img.shields.io/badge/Vue-3.5-4FC08D.svg)](https://vuejs.org/)
[![Python](https://img.shields.io/badge/Python-3.8+-3776AB.svg)](https://www.python.org/)

[功能特性](#功能特性) • [快速开始](#快速开始) • [使用说明](#使用说明) • [项目结构](#项目结构) • [许可证](#许可证)

</div>

---

## 📖 简介

直播助手是一个为抖音主播打造的本地桌面工具，支持实时监控直播间弹幕、礼物、进场事件，并通过可视化规则引擎触发各种整蛊动作（音效、弹窗、TTS 语音播报、OBS 叠加层等）。

> ⚠️ **重要说明**：本项目基于抖音网页版弹幕协议（非官方开放平台 API），仅供个人学习和自用。抖音协议随时可能变更导致失效。

## ✨ 功能特性

### 已实现功能

- ✅ **实时弹幕监控**：支持抖音直播间弹幕、礼物、点赞、进场事件实时推送
- ✅ **Mock 模式**：无需开播即可模拟测试规则和动作
- ✅ **智能规则引擎**：
  - 关键词匹配（支持正则表达式）
  - 礼物价值门槛触发
  - 多条件组合规则
  - 可视化规则编辑器
- ✅ **多种动作支持**：
  - 桌面通知
  - 系统 TTS 播报
  - MeloTTS 本地高质量语音合成
  - OBS 浏览器源叠加层（弹幕悬浮窗）
  - 自定义音效（预留）
- ✅ **直播回放录制**：保存直播事件数据，支持离线回放分析
- ✅ **礼物管理**：自定义礼物钻石价值，精确统计收益
- ✅ **统计面板**：实时统计观众数、礼物价值、点赞数等
- ✅ **管理员权限检测**：需要管理员权限时自动提示

### 规划中功能

- ⏳ OBS WebSocket 深度联动（切换场景、控制源）
- ⏳ 更多 TTS 引擎支持
- ⏳ 自定义音效库管理
- ⏳ 多直播平台支持（B站、快手等）

## 🚀 快速开始

### 环境要求

- **Node.js**: >= 16.0
- **Python**: >= 3.8
- **操作系统**: Windows 10/11（其他平台未测试）

### 安装步骤

#### 1. 克隆项目

```bash
git clone https://github.com/touchfish/live-stream-assistant.git
cd live-stream-assistant
```

#### 2. 安装依赖

```bash
# 安装 Python 依赖（弹幕服务）
cd core
pip install -r requirements.txt
cd ..

# 可选：安装 TTS 依赖（MeloTTS 语音合成）
pip install -r core/requirements-tts.txt

# 安装桌面端依赖
cd app
npm install
cd ..
```

#### 3. 启动服务

**推荐方式**（需要三个终端）：

```bash
# 终端 1: 启动弹幕服务（Mock 模式测试）
npm run core:mock

# 终端 2: 启动 TTS 服务（可选）
npm run tts

# 终端 3: 启动桌面应用
npm run app
```

**或者使用独立命令**：

```bash
# 仅启动桌面端（适合打包后的 exe）
cd app
npm run electron:dev
```

### 打包发布

```bash
cd app
npm run pack
```

生成的可执行文件位于 `app/release/直播助手-0.1.0-beta.14-portable.exe`

## 📚 使用说明

### 连接直播间

1. **获取直播间号**：
   - 在浏览器打开 `https://live.douyin.com/你的直播号`
   - 复制 URL 中 `/` 后面的数字（如 `123456789`）

2. **连接配置**：
   - 打开桌面应用
   - 在「设置」页面填入直播间号
   - 选择「抖音」平台
   - 点击「连接」（需要正在开播）

3. **Cookie 配置（可选）**：
   - 如遇到连接失败，可能需要配置 Cookie
   - 浏览器打开抖音直播，F12 控制台获取 Cookie
   - 在应用设置中填入 Cookie

### 配置整蛊规则

1. 进入「规则工作室」
2. 点击「新建规则」
3. 设置触发条件：
   - **关键词匹配**：弹幕包含特定文字
   - **礼物门槛**：礼物价值达到指定金额
   - **用户条件**：指定用户触发
4. 选择动作：
   - 桌面通知
   - TTS 播报
   - OBS 叠加层显示
5. 保存并启用规则

### OBS 集成

1. **配置叠加层**：
   - OBS 添加「浏览器源」
   - URL 填入：`http://localhost:45678/overlay`
   - 尺寸建议：1920x1080

2. **自定义样式**：
   - 在应用「OBS 设置」中调整弹幕样式、位置、动画效果

### 回放功能

1. 在「设置」中启用「录制回放」
2. 直播结束后，点击「回放」标签查看历史数据
3. 支持导出 JSON 数据用于分析

## 📂 项目结构

```
live-stream-assistant/
├── app/                          # Electron + Vue3 桌面应用
│   ├── electron/                 # Electron 主进程
│   │   ├── main.cjs              # 主进程入口
│   │   ├── preload.cjs           # 预加载脚本
│   │   ├── actionExecutor.cjs    # 动作执行器
│   │   ├── ttsService.cjs        # TTS 服务调度
│   │   ├── overlayServer.cjs     # OBS 叠加层服务器
│   │   └── replayStore.cjs       # 回放数据存储
│   ├── src/                      # Vue 渲染进程
│   │   ├── components/           # UI 组件
│   │   ├── composables/          # 组合式函数
│   │   ├── lib/                  # 业务逻辑
│   │   │   ├── prank/            # 整蛊规则引擎
│   │   │   ├── replay/           # 回放录制
│   │   │   └── storage.ts        # 本地存储
│   │   └── App.vue               # 根组件
│   └── package.json
├── core/                         # Python 弹幕服务
│   ├── fetcher/                  # 弹幕采集器
│   │   ├── douyin.py             # 抖音弹幕采集
│   │   ├── mock.py               # Mock 模式
│   │   └── idle.py               # 待机模式
│   ├── vendor/                   # 第三方依赖
│   │   └── douyin_web/           # 抖音网页协议
│   ├── server.py                 # WebSocket 服务器
│   ├── tts_server.py             # MeloTTS 语音服务
│   └── requirements.txt
├── models/                       # MeloTTS 模型文件（不上传）
├── vendor/                       # 外部工具（不上传）
├── tools/                        # 开发工具脚本
├── .gitignore
├── LICENSE
├── README.md
└── package.json
```

## 🛠️ 技术栈

- **桌面端**：Electron 37 + Vue 3.5 + TypeScript + Vite
- **后端服务**：Python 3.8+ + WebSocket + asyncio
- **弹幕协议**：抖音网页版 WebSocket（逆向）
- **语音合成**：MeloTTS（本地推理）
- **OBS 集成**：HTTP Server + Browser Source

## ⚠️ 注意事项

1. **协议风险**：本项目使用抖音网页版协议，可能随时失效，不保证长期可用
2. **仅供个人使用**：请勿用于商业目的，商业使用需联系作者获取授权
3. **Cookie 安全**：请勿将 Cookie 分享给他人，避免账号安全风险
4. **管理员权限**：部分功能需要以管理员身份运行
5. **资源占用**：MeloTTS 语音合成会占用较多 CPU/GPU 资源

## 🤝 贡献指南

欢迎提交 Issue 和 Pull Request！

1. Fork 本项目
2. 创建特性分支 (`git checkout -b feature/AmazingFeature`)
3. 提交更改 (`git commit -m 'Add some AmazingFeature'`)
4. 推送到分支 (`git push origin feature/AmazingFeature`)
5. 打开 Pull Request

## 📄 许可证

本项目采用 **CC BY-NC-SA 4.0**（知识共享署名-非商业性使用-相同方式共享 4.0 国际许可协议）。

**简单来说**：
- ✅ 可以自由使用、修改、分享本项目
- ✅ 需要保留原作者署名
- ✅ 修改后需使用相同许可证
- ❌ **禁止商业使用**（商业使用需联系作者获得明确授权）

详见 [LICENSE](LICENSE) 文件。

## 📧 联系方式

- **作者**: touchfish
- **邮箱**: touchfish.cc@outlook.com
- **GitHub**: https://github.com/touchfish/live-stream-assistant

## ⭐ Star History

如果这个项目对你有帮助，请给个 Star ⭐️

---

<div align="center">

Made with ❤️ by touchfish

</div>
