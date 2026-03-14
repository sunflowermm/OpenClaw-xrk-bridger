<div align="center">

# 🌉 OpenClaw-xrk-bridger

**OpenClaw Gateway 通道插件：以 WebSocket 客户端接入 XRK-AGT 的 XrkBridge Tasker，将 XRK 的主人私聊等事件接入 OpenClaw Agent，并将回复回推到 XRK-AGT，由 XRK-AGT 再发回 QQ / 其他端。**

[![XRK-AGT](https://img.shields.io/badge/XRK--AGT-runtime-blue.svg)](https://github.com/sunflowermm/XRK-AGT)
[![Openclaw-Core](https://img.shields.io/badge/Openclaw--Core-core%20bridge-green.svg)](https://github.com/sunflowermm/Openclaw-Core)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

</div>

---

## 📦 项目定位

- **通道类型**：OpenClaw Gateway 通道 / 插件，通道 ID 示例：`xrk-agt-bridge`
- **主要职责**：
  - 作为 **WebSocket 客户端** 连接 XRK-AGT 的 `/XrkBridge`
  - 接收 XRK 标准化后的入站消息 → 交给 OpenClaw Agent / Workflow 处理
  - 将 Agent 回复（文本 + 文件）通过同一 WS 回传 XRK-AGT
- **XRK-AGT 侧对应模块**：[`Openclaw-Core`](https://github.com/sunflowermm/Openclaw-Core)（或 XRK-AGT 仓库内的 `core/Openclaw-Core/`）

---

## 🔧 运行依赖

- Node.js ≥ 18（建议 24+）
- OpenClaw Gateway（兼容 2026.x）
- 已安装并启用 XRK-AGT，且 `Openclaw-Core` 总开关 `data/openclaw/openclaw.yaml` 中 `enabled: true`

---

## 🚀 安装到 OpenClaw

### 方式一：通过 OpenClaw CLI 安装（推荐）

在任意终端执行（需 OpenClaw CLI 已安装且已配置 npm registry）：

```bash
openclaw plugins install openclaw-xrk-bridger
```

安装完成后，OpenClaw 会在：

- Windows：`%USERPROFILE%\.openclaw\extensions\openclaw-xrk-bridger\`
- Linux/macOS：`~/.openclaw/extensions/openclaw-xrk-bridger/`

下创建插件目录，并在配置中注册一个可在控制台中编辑的通道。

### 方式二：从源码构建后手动部署（开发者）

1. 本地构建生成 `dist/`：

   ```bash
   pnpm install
   pnpm build
   ```

2. 将以下文件复制到 OpenClaw 的扩展目录，例如：

   - `dist/*.js`
   - `openclaw.plugin.json`
   - `package.json`

   目标目录示例（Windows）：

   - `%USERPROFILE%\.openclaw\extensions\openclaw-xrk-bridger\`

3. 之后同样通过 Gateway 控制台进行配置（见下文），无需手动编辑 `openclaw.json`。

---

## ⚙️ 在 Gateway 控制台中配置

安装完成并启动 Gateway 后，打开 **OpenClaw Gateway 控制台**：

1. 进入「通道 / Channels」或「插件 / Plugins」页面，找到 `XRK-AGT Bridge`（id: `openclaw-xrk-bridger` 或类似）。  
2. 点击进入配置表单，你会看到以下字段（由 `openclaw.plugin.json` 的 `configSchema` 与 `uiHints` 自动生成）：  
   - `XRK-AGT Bridge WS 地址 (wsUrl)`：XRK-AGT 的 XrkBridge WebSocket 地址，格式 `ws://<host>:<port>/XrkBridge`，端口与 XRK-AGT 的 HTTP/WS 端口一致（如 11451），示例：`ws://127.0.0.1:11451/XrkBridge`。  
   - `XRK-AGT 鉴权 Token (accessToken)`（可选，敏感字段）：若 XRK-AGT 侧对 WS 做鉴权，可在此填写，插件会以 `Authorization: Bearer <accessToken>` 请求头连接。
3. 填写完成后点击保存，OpenClaw 会自动将配置写入：

- Windows：`%USERPROFILE%\.openclaw\openclaw.json`
- Linux/macOS：`~/.openclaw/openclaw.json`

无需手工修改 JSON。

---

## 🔄 协议概要（XRK ↔ OpenClaw）

- **XRK → OpenClaw（入站）**  
  XRK 侧 Tasker 需将任意“主人私聊”等事件归一为：

  ```json
  { "id": "...", "type": "message", "kind": "direct" | "group", "selfId": "...", "userId": "...", "groupId": "...", "text": "..." }
  ```

  （如需扩展图片/文件，可在此对象上增加 `files` 字段并在 XRK 自行消费。）

- **OpenClaw → XRK（回复）**  
  本通道会将 Agent 回复转换为：

  ```json
  {
    "id": "...",
    "type": "reply",
    "to": { "kind": "direct" | "group", "userId": "...", "groupId": "..." },
    "text": "...",
    "files": [{ "url": "...", "name": "..." }]
  }
  ```

  `id` 与入站一致，用于请求-响应匹配，`files` 中的资源由 XRK 再发到 QQ / 其它前端。

---

## 底层谁在发文件（.openclaw 内）

本插件内**实际把文件发到 XRK** 的只有两处，都在 `src/channel.ts`：

| 路径 | 触发方 | 说明 |
|------|--------|------|
| **`deliver(payload)`** | OpenClaw 运行时 `dispatchReplyFromConfig` 在 Agent 回复就绪后回调 | 收到 `payload.files` / `payload.mediaUrls`，转成 `client.sendReply({ text, mediaUrls, files })` 发往 XRK。若 runtime 只传 `mediaUrls` 不传 `files`，则无文件名。 |
| **`outbound.sendMedia({ to, text, mediaUrl, accountId, name? })`** | 核心的 **message 工具**（Agent 调「发文件」时） | 原先只发 `mediaUrls`，无 `name`，导致 QQ 显示 `file.pptx`。**已改**：从 `mediaUrl` 路径推断文件名（或使用传入的 `name`），非图片一律用 `files: [{ url, name }]` 发往 XRK，QQ 即可显示正确文件名。 |

结论：**负责发送文件的是上述两处**；其中「Agent 用 message 工具发文件」走 **sendMedia**。当前核心只传 `mediaUrl` 不传 `name`，QQ 上正确显示的文件名来自本插件的**路径推断**；若核心后续传入 `name`，会优先使用。

---

## 排查：回复带文件但 QQ 显示 file.xxx / 后端收到「两文件 + 三次文字」

**现象**：OpenClaw 终端里 `[XRK-Bridge] deliver 收到 payload` 一直显示 `mediaUrls=0 files=0`，但 XRK 端实际收到了带文件的回复，且 QQ 上文件名为 `file.pptx`。

**原因**：带附件的回复走的是 **outbound.sendMedia**（message 工具），未走 `deliver`。旧版 sendMedia 只发 `mediaUrls`，不带 `name`。

**已做修改**：`sendMedia` 现会从 `mediaUrl`（如本地路径、`file://`）推断文件名，并支持可选参数 `name`；非图片一律以 `files: [{ url, name }]` 发往 XRK，QQ 会显示正确名称。若核心的 message 工具把 `name` 一并传给 sendMedia，会优先使用该 `name`。

**调试日志说明**（全在 `[XRK-Bridge]` 前缀下）：

- **deliver 路径**（Agent 回复走统一派发时）：会看到 `deliver 收到 payload: keys=[...] text=有/无 mediaUrls=N files=M`，接着 `sendReply 将发往 XRK`，最后 `client.sendReply 发出 → XRK`。若这里始终是 `mediaUrls=0 files=0`，说明**带文件的回复没有走 deliver**。
- **sendMedia 路径**（Agent 用 message 工具发文件时）：应看到 `outbound.sendMedia 被调用 to=... mediaUrl=... name=...`，接着 `sendMedia 转换: ... inferredName=... → files(带name)`，再 `sendMedia 将发往 XRK: ... files=1 names=[...]`，最后 `client.sendReply 发出 → XRK: ... files=1 fileNames=[...]`。
- **若发文件时从没出现过 `outbound.sendMedia 被调用`**：说明核心没有通过本插件的 `sendMedia` 发文件，而是用**别的路径**（例如直接写 WebSocket、或走其他 channel 接口）。需要在 OpenClaw 主仓里搜「发文件 / 发 reply / message 工具实现」，确认是否调用了当前 channel 的 `outbound.sendMedia` 并传入 `mediaUrl`（及尽量带 `name`）。
- **若 AI 说传了 name 但日志显示 name=(未传)**：看同一条日志里的 **`收到参数 keys=[...]`**，核心可能用了别的字段名。本插件已从下列任一字段取显示名（优先第一个有值）：`name`、`fileName`、`filename`、`displayName`、`file_name`、`file.name`。若 keys 里有你期望的档名但字段名不在上述列表，可在 bridger 的 `sendMedia` 里为该字段加一次读取。

---

## 🔗 相关项目

- **XRK-AGT 主项目**：[`XRK-AGT`](https://github.com/sunflowermm/XRK-AGT)  
- **XRK-AGT 侧桥接 Core**：[`Openclaw-Core`](https://github.com/sunflowermm/Openclaw-Core)

---

## 📄 许可证

本项目基于 **MIT License** 开源，详见 [LICENSE](./LICENSE)。
