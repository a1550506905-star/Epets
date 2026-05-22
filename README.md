# Epets - Windows 桌面宠物

一个基于 Electron 的 Windows 桌面宠物应用，内置 90+ 动漫/游戏角色，支持 AI 对话、宠物商店、剪贴板监听等功能。

## 功能

- **桌面宠物** — 宠物在桌面上自由走动，支持拖拽、缩放、右键菜单
- **AI 对话** — 接入 DeepSeek API，与宠物进行智能聊天
- **宠物商店** — 使用积分解锁更多宠物角色
- **多宠物同屏** — 同时显示多个宠物
- **剪贴板监听** — 自动识别剪贴板内容并提供便捷操作
- **开机自启** — 支持设置为开机自动启动

## 内置角色

包含来自 90+ 动漫和游戏作品的角色，如：哆啦A梦、芙莉莲、五条悟、明日香、蕾姆、亚丝娜、金克丝、玛奇玛等。

## 环境要求

- Windows 10/11
- [Node.js](https://nodejs.org/) 18+
- DeepSeek API Key（用于 AI 对话功能，可在 [DeepSeek 开放平台](https://platform.deepseek.com/) 免费获取）

## 快速开始

```bash
# 安装依赖
npm install

# 启动应用
npm start
```

## 构建

```bash
# 构建 Windows 便携版
npm run build
```

构建产物在 `dist/` 目录下。

## 项目结构

```
├── main.js          # Electron 主进程
├── preload.js       # 预加载脚本
├── run.js           # 启动入口
├── src/             # 渲染进程页面
│   ├── pet-window/  # 宠物显示窗口
│   ├── chat-window/ # AI 对话窗口
│   ├── shop/        # 宠物商店
│   ├── settings/    # 设置页面
│   ├── clipboard/   # 剪贴板监听
│   ├── pet-selector/# 宠物选择器
│   └── about/       # 关于页面
├── pets/            # 宠物资源（spritesheet + 配置）
└── 示例/            # 宠物制作示例
```

## 自定义宠物

参考 `示例/` 目录中的模板，创建自己的宠物角色。每个宠物需要：
- `spritesheet.webp` — 精灵图（动画帧序列）
- `pet.json` — 宠物配置文件

## 技术栈

- **Electron** — 桌面应用框架
- **DeepSeek API** — AI 对话能力
- **PDF.js** — 文档解析（剪贴板功能）

## 许可证

[MIT](LICENSE)
