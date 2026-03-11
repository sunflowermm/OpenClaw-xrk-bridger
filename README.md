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

## 🔗 相关项目

- **XRK-AGT 主项目**：[`XRK-AGT`](https://github.com/sunflowermm/XRK-AGT)  
- **XRK-AGT 侧桥接 Core**：[`Openclaw-Core`](https://github.com/sunflowermm/Openclaw-Core)

---

## 📄 许可证

本项目基于 **MIT License** 开源，详见 [LICENSE](./LICENSE)。
