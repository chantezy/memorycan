<div align="center">

<img src="https://memorycan.chantezy.space/assets/app-icon.png" width="112" alt="记忆罐头" />

# 记忆罐头 · Memory Can

**把散落在各个 AI 工具里的对话，收进一个放在自己硬盘上的罐头柜**

本地优先 · 不上传 · 3D 收藏墙 · 按项目检索

[官网](https://memorycan.chantezy.space/) · [下载](https://github.com/chantezy/memorycan/releases/latest) · [问题反馈](https://github.com/chantezy/memorycan/issues)

</div>

![3D 收藏墙](https://memorycan.chantezy.space/assets/1.png)

## 这是什么

这一年我们和 AI 聊出来的东西，比过去十年记的笔记还多。但它们散落在 Cursor、Claude Code、Codex、Trae 各自的本地目录里：换个工具就看不到上个月的项目，换台电脑就全丢了，清一次缓存可能就再也找不回来。

**记忆罐头**把这些工具留在这台电脑上的会话记录读出来，按项目归拢成一个一个「罐头」，以纯 JSON 存进你自己的文件夹。之后可以按项目浏览、按关键词翻找、看统计，也可以在 3D 收藏墙上把几百个对话一次铺开，像逛一面自己的收藏柜。

整个应用没有账号、没有云同步，数据只走本机磁盘。

## 功能

### 3D 收藏墙

每个项目是一罐不同口味的罐头，按时间与体量摆在柜架上。用鼠标拖动旋转，滚轮推近，点击任意一罐就进入详情。项目多了以后，这面墙比任何列表都更能让人一眼想起「那个红色罐子里的东西」。

### 详情页：原样保留对话

打开一个项目，能看到完整的对话流：Markdown、代码块、表格、思考过程都按原始内容渲染，不会被压缩成摘要。

![详情页](https://memorycan.chantezy.space/assets/2.png)

### 对话与产物文件夹关联

每个项目记录了它当初的工作目录。详情页里可以直接看到这个项目产生过哪些文件、有哪些产物文件夹，知道这段对话最终落地成了什么。

### 按项目搜索与统计

跨项目按关键词检索，也能看到单个项目的消息数、对话轮次、活跃时间段等统计信息。找「上次那个写正则的对话」不用再一个个点开。

### 多种导入方式

- **自动扫描**：识别本机已安装的 AI 工具，直接读取它们的会话目录
- **导入文件夹 / JSONL**：手动指定某个目录，或丢进一份 `.jsonl` 会话文件
- **通用格式**：任何符合约定结构的 JSONL 都能被导入

### 隐私可控

所有解析都在本地完成，解析结果落在你自己的文件夹里。仓库里附带 `anonymize_chat_logs.py`，需要把记录分享出去或提 issue 时，可以先用它把路径、用户名等信息抹掉。

## 下载

| 平台 | 架构 | 安装包 |
| --- | --- | --- |
| macOS | Apple Silicon（arm64） | [memorycan1.0.0-arm64.dmg](https://github.com/chantezy/memorycan/releases/download/v1.0.0/memorycan1.0.0-arm64.dmg) |
| Windows | x64 | [memorycan1.0.0.exe](https://github.com/chantezy/memorycan/releases/download/v1.0.0/memorycan1.0.0.exe) |

也可以在 [Releases](https://github.com/chantezy/memorycan/releases/latest) 页面选择其他版本。

**系统要求**：macOS 11 及以上（暂不支持 Intel 芯片 Mac）／ Windows 10 及以上。

### 安装时会被系统拦一下

安装包没有做代码签名，所以首次打开会被系统提示：

- **macOS**：提示「无法打开，因为 Apple 无法验证」。到「系统设置 → 隐私与安全性」拉到底，点「仍要打开」；或者右键点图标选「打开」。
- **Windows**：SmartScreen 提示「Windows 已保护你的电脑」。点「更多信息」→「仍要运行」。

## 支持的数据来源

| 工具 | 读取位置 |
| --- | --- |
| Claude Code | `~/.claude/` |
| Codex CLI / Codex 桌面端 | `~/.codex/`、`~/Library/Application Support/Codex` |
| Claude 桌面端 | `~/Library/Application Support/Claude` |
| Cursor | `~/Library/Application Support/Cursor/User` |
| Trae | `~/Library/Application Support/TRAE SOLO CN/User` |
| VS Code Copilot | `~/Library/Application Support/Code/User` |
| Windsurf | `~/Library/Application Support/Windsurf/User` |
| Qoder | `~/Library/Application Support/Qoder/User` |
| CodeBuddy | `~/.codebuddy/` |
| Cindy | `~/Library/Application Support/Cindy` |

Windows 下对应的是 `%APPDATA%` 下的同名目录。没有出现在表里的工具，可以用「导入文件夹」手动接入。

## 本地开发

需要 **Node.js 24 或更高版本**。

### 跑前端

```bash
cd web
npm install
npm run dev          # http://localhost:3000
```

### 跑桌面端

```bash
cd electron
npm install
npm start            # 以生产前端启动
npm run dev          # 开发模式
```

桌面端启动时会依次寻找可用的内容目录（`~/Documents/记忆罐头` 等）；如果都没有，就把随包的前端与空数据目录 seed 一份到 `~/Documents/记忆罐头`，保证开箱能用。

### 打包安装包

```bash
cd web && npm run build          # 生成静态导出到 web/dist
cd ../electron
npm run build                    # macOS → dmg + zip
npm run build:win                # Windows → exe
npm run build:dir                # 只出 .app，不压安装包（调试用）
```

## 项目结构

```
.
├── web/          # Next.js 静态导出前端：界面、3D 场景、详情页
│   └── dist/     # build 产物，被桌面端当作 renderer 加载
├── electron/     # 桌面主进程：会话解析、文件系统、打包配置
│   ├── src/      # detectors（工具探测）与 sqlite 解析器
│   └── build/    # 图标与 dmg 资源
└── homepage/     # 官网落地页，纯静态 HTML
```

前端是 Next.js 的 `output: "export"` 静态导出，没有服务端运行时；Electron 直接把 `web/dist` 当普通网页加载，所以离线可用。

## 数据存在哪

| 内容 | 路径 |
| --- | --- |
| 项目罐子 | `~/Documents/记忆罐头/projects/*.json` |
| 项目索引 | `~/Documents/记忆罐头/data/projects.json` |
| 前端快照 | `~/Documents/记忆罐头/web/dist/` |

**换电脑或备份**：把整个 `~/Documents/记忆罐头` 文件夹拷走就行，没有数据库、没有加密、没有隐藏状态。数据目录的位置也可以在应用内重新指定。

## 常见问题

**打开后是空的，没看到我的对话？**
应用默认只扫描本机已有的工具目录。如果某个工具的路径比较特殊，用「导入文件夹」手动指向它的会话目录。

**会不会把我的对话传到网上？**
不会。解析、存储、渲染全部在本机完成，应用没有账号体系也没有云同步接口。

**支持 Intel 芯片的 Mac 吗？**
目前只提供 arm64 版本。

**可以同时放在多个设备上吗？**
可以。每台设备各自扫描自己的工具目录；想把记录合并，就把某个设备的 `projects/` 拷到另一台上。

## 参与

欢迎提 Issue 聊需求、报 bug，或者直接 PR。如果这个项目对你有用，点个 Star 就是最好的支持。

## License

[MIT](LICENSE)
