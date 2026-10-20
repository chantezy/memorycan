# 记忆罐头

将不同 AI 智能体（Cursor / Trae / Claude Code / Codex / WorkBuddy / Qoder 等）的对话记录，整理成可按「罐头」浏览的可视化收藏。

## 功能

- 扫描本地已安装的智能体，一键导入对话记录
- 每个项目生成一只 3D 罐头，罐身贴图展示项目名称与主题色
- 详情页查看对话原文（Markdown 富文本）、模型偏好、贡献热力图
- 内置数据脱敏脚本，导出前可按要求脱敏密钥 / token / PII

## 技术栈

- 前端：Next.js 16（静态导出 `output: "export"`）+ React 19 + TypeScript
- 3D：React Three Fiber / drei / three
- 桌面端：Electron 33 + electron-builder
- 数据解析：各智能体本地数据库（SQLite / JSON）解析脚本

## 目录结构

```
记忆罐头/
├── web/             # Next.js 前端（静态导出到 web/dist）
│   ├── src/         # 页面与组件
│   ├── public/      # 静态资源（icon、字体、3D 模型）
│   └── dist/        # 生产构建产物（运行时由 Electron 读取）
├── electron/        # Electron 主进程（main.js / preload.js / src）
├── projects/        # 导入后的项目数据（每个项目一个文件夹）
├── data/            # 运行时缓存（projects.json）
└── 给智能体的数据收集指令.md  # 交给 AI 整理记录的标准提示词
```

## 开发

```bash
cd web
npm run dev        # 本地预览（localhost:3406）
npm run build      # 生产构建，输出到 web/dist
```

## 打包桌面应用

```bash
cd electron
npm run build      # 打包 macOS DMG / zip
npm run build:win  # 打包 Windows 安装包（建议在 Windows 或 CI 环境运行）
```

> 安装包为自包含：首次运行会在 `~/Documents/记忆罐头` 自动建立项目目录。
> 真实项目数据（projects/、data/）不进入安装包，保证隐私与可写。
