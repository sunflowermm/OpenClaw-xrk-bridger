# OpenClaw-xrk-bridger

OpenClaw 通道插件：以 **WebSocket 客户端** 连接 XRK-AGT 的 XrkBridge Tasker，接收来自 XRK 的标准化消息并交给 OpenClaw Agent 处理，回复经同一 WS 回传 XRK-AGT，由 XRK-AGT 再发回 QQ / 其他端。通道 ID：`xrk-agt`。

## 依赖

- Node.js ≥ 18（建议 24+）
- OpenClaw Gateway（兼容 2026.x）
- 已安装并启用 XRK-AGT，且 Openclaw-Core 总开关 `data/openclaw/openclaw.yaml` 中 `enabled: true`

## 安装到 OpenClaw

1. **方式一：通过 npm 安装（推荐）**  
   在任意终端执行（需 OpenClaw CLI 已安装且已配置 npm registry）：
   ```bash
   openclaw plugins install openclaw-xrk-bridger
   ```
   安装完成后，OpenClaw 会在 `~/.openclaw/extensions/xrk-agt-bridge/` 下创建插件目录，并在配置中注册一个可在控制台中编辑的通道。

2. **方式二：从源码构建后手动部署（开发者）**  
   - 本地按上一节「构建」生成 `dist/`；
   - 将 `dist/*.js`、`openclaw.plugin.json`、`package.json` 复制到 OpenClaw 的扩展目录，例如：
     - Windows：`%USERPROFILE%\.openclaw\extensions\xrk-agt-bridge\`
   - 之后同样通过 Gateway 控制台进行配置（见下文），无需手动编辑 `openclaw.json`。

## 配置

安装完成并启动 Gateway 后，打开 **OpenClaw Gateway 控制台**：

1. 进入「通道 / Channels」或「插件 / Plugins」页面，找到 `XRK-AGT Bridge`（id: `xrk-agt-bridge`）。  
2. 点击进入配置表单，你会看到以下字段（由 `openclaw.plugin.json` 的 `configSchema` 与 `uiHints` 自动生成）：  
   - `XRK-AGT Bridge WS 地址 (wsUrl)`：XRK-AGT 的 XrkBridge WebSocket 地址，格式 `ws://<host>:<port>/XrkBridge`，端口与 XRK-AGT 的 HTTP/WS 端口一致（如 11451），示例：`ws://127.0.0.1:11451/XrkBridge`。
   - `XRK-AGT 鉴权 Token (accessToken)`（可选，敏感字段）：若 XRK-AGT 侧对 WS 做鉴权，可在此填写，插件会以 `Authorization: Bearer <accessToken>` 请求头连接。
3. 填写完成后点击保存，OpenClaw 会自动将配置写入 `~/.openclaw/openclaw.json`，无需手工修改 JSON。

## 协议概要（XRK ↔ OpenClaw）

- **XRK → OpenClaw（入站）**  
  XRK 侧 Tasker 需将任意“主人私聊”等事件归一为：
  ```json
  { "id": "...", "type": "message", "kind": "direct" | "group", "selfId": "...", "userId": "...", "groupId": "...", "text": "..." }
  ```
  （如需扩展图片/文件，可在此对象上增加 `files` 字段并在 XRK 自行消费。）

- **OpenClaw → XRK（回复）**  
  本通道会将 Agent 回复转换为：
  ```json
  { "id": "...", "type": "reply", "to": { "kind": "direct" | "group", "userId": "...", "groupId": "..." }, "text": "...", "files": [{ "url": "...", "name": "..." }] }
  ```
  `id` 与入站一致，用于请求-响应匹配，`files` 中的资源由 XRK 再发到 QQ / 其它前端。

## 许可证

MIT
