---
name: xrk-screenshot
description: |
  XRK-AGT / QQ 场景下的桌面截图指引：生成本机截图文件，再通过 mediaUrls/files 发回 QQ。
---

# XRK 截图技能（桌面环境）

## 技能概述
- 提供本地 Windows 桌面截图能力，通过 `screenshot-desktop` 库实现
- 支持自动化截图后直接发送至 XRK/QQ 等通道
- 脚本默认生成在 OpenClaw workspace 目录，便于统一管理

> **适用范围**：本 SKILL 仅在你通过 **`xrk-agt` 通道（openclaw-xrk-bridger 插件）** 与 QQ 交互时适用。  
> 若当前上下文不是 XRK-AGT / QQ 场景（没有 QQ 号/群号、也没有 `Provider: "xrk-agt"` / `Channel: "xrk-agt"` 等字段），请不要假定可以给 QQ 发截图。

## 适用场景
- 自动化任务中需要截图的场景
- 远程控制或监控需要截图的场景
- 与 XRK 通道配合使用的截图需求

## 依赖安装与“全局安装”用法

- **安全原则**：openclaw-xrk-bridger 插件本身**不会去 require/import 任何全局包**，也不会假设你已经装了什么；截图完全由你自己的脚本负责。
- **你坚持全局安装时**，推荐两种方式：
  1. `npm install -g screenshot-desktop`，然后在你自己的脚本里用 `require('screenshot-desktop')` 或 `import screenshot from 'screenshot-desktop'`。  
     - 这依赖于 Node 能从全局模块目录解析到该包（Windows 下一般可以，但不保证所有环境都一致）。
  2. 使用 `npx` 显式指定依赖来源，例如：
     - `npx -p screenshot-desktop node take-screenshot.js`  
       这样不需要本地安装，也不会改动 openclaw 插件的依赖列表。
- **更推荐的做法（本地小项目）**：
  - 在 `C:\Users\sunflowerss\.openclaw\workspace\` 下初始化一个小 Node 项目：
    - `cd C:\Users\sunflowerss\.openclaw\workspace`
    - `npm init -y && npm install screenshot-desktop`
  - 然后在这里创建脚本文件，使用 `require` 或 `import`，不会污染全局环境。

## 脚本模板（take-screenshot.js，require 版）

**建议保存到 `C:\Users\sunflowerss\.openclaw\workspace\take-screenshot.js`：**

## 脚本模板（take-screenshot.mjs，import 版）

如果你更喜欢 `import` 写法，可以用 ESM：

```javascript
#!/usr/bin/env node
import screenshot from 'screenshot-desktop';
import path from 'path';
import fs from 'fs/promises';
import os from 'os';

const workspacePath =
  process.env.OPENCLAW_WORKSPACE ||
  (process.env.USERPROFILE
    ? `${process.env.USERPROFILE}\\.openclaw\\workspace`
    : `${os.homedir()}\\.openclaw\\workspace`);

const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const filename = `screenshot-${timestamp}.png`;
const outputPath = path.join(workspacePath, filename);

try {
  const imgBuffer = await screenshot();
  await fs.mkdir(workspacePath, { recursive: true });
  await fs.writeFile(outputPath, imgBuffer);
  console.log(outputPath);
} catch (err) {
  console.error('Failed to take screenshot:', err.message);
  process.exit(1);
}
```

## 使用方式

### 1. 直接运行脚本
```bash
# 或 import 版
node "C:\Users\sunflowerss\.openclaw\workspace\take-screenshot.mjs"
```

若你坚持“全局安装”：

```bash
# 全局安装一次
npm install -g screenshot-desktop

# 或者用 npx 每次显式带上依赖
npx -p screenshot-desktop node "C:\Users\sunflowerss\.openclaw\workspace\take-screenshot.js"
```

### 2. 与 XRK 通道配合使用
1. 运行截图脚本获取截图路径（脚本会在 stdout 打印一个绝对路径）。
2. 在回复里把该路径放进 `mediaUrls`：
   - 例如：`{ "text": "当前截图。", "mediaUrls": ["C:/Users/.../screenshot-xxxx.png"] }`
3. XRK 通道会自动处理本地文件路径，转换为 base64 格式并发送到 QQ。

## 后续处理与注意事项
- 截图自动保存至 OpenClaw workspace 目录，文件名含时间戳。
- 可直接将输出的文件路径复制到聊天消息中，XRK 通道会自动识别并处理本地文件路径。
- 截图过程可能会短暂占用系统资源，大量截图会占用存储空间，建议定期清理。
- 对于敏感信息，请谨慎处理截图文件。
