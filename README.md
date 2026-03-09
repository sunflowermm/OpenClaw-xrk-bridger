# OpenClaw-xrk-bridger

OpenClaw 通道插件：以 **WebSocket 客户端** 连接 XRK-AGT 的 XrkBridge Tasker，接收 QQ 消息并交给 OpenClaw Agent 处理，回复经同一 WS 回传 XRK-AGT，由 XRK-AGT 再发回 QQ。通道 ID：`xrk-agt`。

## 依赖

- Node.js ≥ 18（建议 24+）
- OpenClaw Gateway（兼容 2026.x）
- 已安装并启用 XRK-AGT，且 Openclaw-Core 总开关 `data/openclaw/openclaw.yaml` 中 `enabled: true`

## 构建

```bash
cd OpenClaw-xrk-bridger
pnpm install
pnpm run build
```

产物在 `dist/`（`index.js`、`channel.js`、`client.js`、`runtime.js`）。

## 安装到 OpenClaw

1. **方式一：从本仓库安装**  
   在项目根或本目录执行（需 OpenClaw CLI）：
   ```bash
   openclaw plugins install ./core/Openclaw-Core/OpenClaw-xrk-bridger
   ```
   安装时会使用 `package.json` 的 `openclaw` 与 `openclaw.plugin.json` 的配置。

2. **方式二：手动部署**  
   - 将 `dist/*.js`、`openclaw.plugin.json`、`package.json` 复制到 OpenClaw 的扩展目录，例如：
     - Windows：`%USERPROFILE%\.openclaw\extensions\xrk-agt-bridge\`
   - 在 OpenClaw 配置中启用插件并填写 `wsUrl`（见下）。

## 配置

在 OpenClaw 的配置文件（如 `~/.openclaw/openclaw.json`）中：

```json
{
  "plugins": {
    "enabled": true,
    "allow": ["xrk-agt-bridge"],
    "entries": {
      "xrk-agt-bridge": {
        "enabled": true,
        "config": {
          "wsUrl": "ws://127.0.0.1:11451/XrkBridge",
          "accessToken": ""
        }
      }
    }
  }
}
```

- **wsUrl**（必填）：XRK-AGT 的 XrkBridge WebSocket 地址，格式 `ws://<host>:<port>/XrkBridge`，端口与 XRK-AGT 的 HTTP/WS 端口一致（如 11451）。
- **accessToken**（可选）：若 XRK-AGT 侧对 WS 做鉴权，可在此填写，插件会以 `Authorization: Bearer <accessToken>` 请求头连接。

## 协议概要（XRK ↔ OpenClaw）

- **XRK → OpenClaw（入站）**：`{ id, type: "message", kind: "direct"|"group", selfId, userId, groupId?, text }`
- **OpenClaw → XRK（回复）**：`{ id, type: "reply", to: { kind, userId, groupId? }, text?, files? }`  
  `id` 与入站一致，用于请求-响应匹配。

## 底层可用性（OpenClaw 侧）

- 插件通过 OpenClaw 的 **扩展/通道** 机制加载，使用 `api.runtime`（channel.routing、channel.reply、channel.session）处理入站与回复，不修改 OpenClaw 核心代码。
- 需 OpenClaw 提供：`register(api)`、`api.registerChannel`、`api.runtime.channel.*` 及 `openclaw.plugin.json` 的 `configSchema` 校验。

## 许可证

MIT
