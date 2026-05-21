# Windows桌面宠物软件 — 设计规格

## 概述

基于Electron的Windows桌面宠物应用。支持多宠物、9种动画、LLM对话、剪贴板管理、文件拖拽暂存。

## 技术栈

- **框架**: Electron 28+
- **前端**: HTML5 Canvas + CSS3
- **大模型**: DeepSeek API
- **打包**: electron-builder

## 多窗口架构

```
┌─────────────────┐     ┌──────────────┐     ┌──────────────┐
│   主进程 main.js  │────▶│ 宠物窗口      │     │ 聊天窗口      │
│   窗口管理/IPC    │     │ Canvas动画    │     │ DeepSeek对话  │
│   托盘/生命周期    │     │ 透明置顶      │     │ 现代UI       │
└─────────────────┘     └──────────────┘     └──────────────┘
```

- 宠物窗口：透明、置顶、鼠标穿透可切换、Canvas渲染动画
- 聊天窗口：独立面板窗口，双击宠物打开，连接DeepSeek API
- IPC通信：主进程协调各窗口

## 文件结构

```
epets-5/
├── main.js              # Electron主进程入口
├── preload.js           # contextBridge安全桥接
├── package.json
├── src/
│   ├── pet-window/
│   │   ├── index.html
│   │   ├── renderer.js  # Canvas动画引擎
│   │   ├── behavior.js  # 行为调度
│   │   └── style.css
│   ├── chat-window/
│   │   ├── index.html
│   │   ├── renderer.js
│   │   └── style.css
│   ├── services/
│   │   ├── pet-manager.js
│   │   ├── clipboard.js
│   │   ├── deepseek.js
│   │   └── file-manager.js
│   └── assets/
├── pets/                # 宠物文件夹
│   ├── 哆啦A梦/
│   └── 炼狱杏寿郎/
└── 暂存文件/
```

## 精灵表动画系统

精灵表格式：9行，每行一种动画，帧从0到n均匀排列。

| 行 | 动画 | 帧数 |
|----|------|------|
| 0 | 待机 idle | 6 |
| 1 | 向右跑 run_right | 8 |
| 2 | 向左跑 run_left | 8 |
| 3 | 挥手 wave | 4 |
| 4 | 跳跃 jump | 5 |
| 5 | 失落 sad | 8 |
| 6 | 发呆 blank | 6 |
| 7 | 奔跑 running | 6 |
| 8 | 疑惑 confused | 6 |

- 每帧宽度 = 精灵表总宽 / 该行动画帧数
- 帧切换间隔：120-150ms（根据动画类型微调）
- 渲染时从精灵表裁剪对应帧绘制到Canvas

## 行为调度

- 默认播放「待机」动画
- 定时器间隔：5-15秒随机触发其他动画
- 触发规则：
  - 「向右跑」→ 宠物向右移动(x+=速度)，持续到移动完成 → 切回待机
  - 「向左跑」→ 同上向左
  - 「挥手」「跳跃」「失落」「发呆」「疑惑」→ 播放一次完整动画 → 切回待机
- 屏幕边缘检测：动画前检查是否超出显示器边界
- 多显示器：获取所有显示器工作区，限制移动范围

## DeepSeek API 集成

- API地址：https://api.deepseek.com/v1/chat/completions
- API Key：存储在localStorage，首次使用弹出设置
- 系统提示词：根据宠物 pet.json 中的 name 和 description 构建角色提示
- 对话窗口：聊天式UI，流式输出(SSE)

## 剪贴板管家

- 主进程定时读取剪贴板(每秒)
- 内容变化时记录到内存 + 本地文件
- 24小时过期自动清理
- 右键菜单显示最近剪贴内容，点击复制

## 文件拖拽

- 监听宠物窗口的drop事件
- 将文件复制到「暂存文件」目录
- 检测文件类型：
  - .txt .docx .pdf .md → 触发文档总结（调用DeepSeek）
  - 其他 → 仅暂存，提示收纳成功

## 菜单设计

- 右键宠物弹出上下文菜单
- 使用原生Electron Menu（可自定义渲染菜单面板）
- 菜单项：选择宠物、剪贴板历史、设置、关于、退出
- 设计风格：毛玻璃效果、圆角、简洁图标
