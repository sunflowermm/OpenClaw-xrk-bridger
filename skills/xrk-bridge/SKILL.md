---
name: xrk-bridge
description: |
  给 AI 看的 XRK-AGT ↔ OpenClaw Bridge 通道说明。
  目标：让你正确理解消息链路、字段约定、边界与失败模式，避免做出与实现不一致的假设。
---

# XRK Bridge（给 AI 的底层说明）

## 0. 你需要记住的三句话

- 这条桥接由 XRK-AGT 端的 `core/Openclaw-Core/tasker/XrkBridge.js` 实现（Tasker：`XrkBridgeTasker`），WS 路径为 **`/XrkBridge`**。
- **正常对话**：QQ 事件被 XRK-AGT 转成一条 `type: "message"` 发给 OpenClaw；你在 OpenClaw 侧产出 `type: "reply"` 再发回 XRK-AGT，XRK-AGT 会把回复回送到 QQ。
- **你不需要碰 WebSocket**；你只需要产出正确的回复对象：`text` / `mediaUrls` / `files`（以及必要时的 `to`）。

## 1. XRK-AGT 端转发逻辑（概念级，和实现一致）

XRK-AGT 收到 QQ 事件 `e` 后，会在 `forwardEvent(e)` 中：

- 生成文本 `text = (e.msg || e.plainText || e.raw_message || '').trim()`。
- 抽取媒体：
  - 从 `e.msg` 的 segment（`type: "image" | "file"`）提取 `mediaUrls` / `files`；
  - 并从 `e.raw_message` 的 CQ 码（`[CQ:image,...]`）补充图片 URL。
- 若 `text`、`mediaUrls`、`files` 全为空：**不会转发**（直接忽略）。
- 否则调用 `sendToOpenclaw(e, text, mediaUrls, files)` 发送：
  - XRK-AGT 会生成 `id`（ulid）并放入 `pending`，等待回包。
  - 超时默认 **120 秒**（`timeout = 120000`）。

OpenClaw → XRK-AGT 的入站消息处理：

- 仅当 `payload.type === "reply"` 时进入回复分支。
- 若 `payload.id` 能匹配 `pending`：视为“对应这次对话的回包”，交给当前事件上下文继续处理。
- 若 `payload.id` 不能匹配：调用 `handleDirectReply(payload)`，视为“主动推送到 QQ 的消息”。

## 2. OpenClaw 回包（reply）你应该怎么构造

### 2.1 最常用：回复当前会话（推荐默认）

你通常只需要返回“内容字段”，例如：

```json
{
  "text": "好的，已经为你处理完。",
  "mediaUrls": ["C:/path/to/image.png"],
  "files": [{ "url": "C:/path/to/doc.pdf", "name": "说明文件.pdf" }]
}
```

字段说明：

- `text`：要发回 QQ 的文字（可选）。
- `mediaUrls: string[]`：要发回 QQ 的图片/媒体（可选）。
- `files: { url: string, name?: string }[]`：要发回 QQ 的文件（可选）。

> 绝大多数场景不要指定 `to`，让系统“回复当前触发会话”即可。

### 2.2 进阶：主动发到指定 QQ（无当前事件也能发）

当你明确要做“通知/广播/异步推送”，可以构造带 `to` 的 reply：

```json
{
  "type": "reply",
  "to": {
    "kind": "group",
    "groupId": "123456789",
    "selfId": "123456"
  },
  "text": "这是一条主动消息",
  "mediaUrls": [],
  "files": []
}
```

`to` 结构：

- `to.kind`: `"group"` 或 `"direct"`
- `to.groupId`: 群号（kind=group 时必填）
- `to.userId`: QQ 号（kind=direct 时必填）
- `to.selfId`: 机器人自身 QQ（可选；多 Bot/多账号时建议提供）

XRK-AGT 会使用：

- 群：`Bot.pickGroup(groupId, selfId)` 然后 `sendMsg(...)`
- 私聊：`Bot.pickFriend(userId, selfId)` 然后 `sendMsg(...)`

## 3. 媒体/文件路径规则（必须理解，否则会发不出去）

XRK-AGT 对 `mediaUrls[]` 与 `files[].url` 的处理逻辑（实现级）：

- `base64://...`：直接使用。
- `http://` / `https://`：直接使用。
- 其他：当作本机路径（支持 `file://` 前缀），XRK-AGT 会尝试读取文件并转成 `base64://...`。
- 当内容为 base64 时，XRK-AGT 会用 `file-type` 检测 mime：
  - `image/*` → 按图片发送
  - 其他 → 按文件发送（文件名可能会自动变成 `file.<ext>`）

**你应该怎么做：**

- 只填“真实存在”的本机路径，或真实可访问的 URL。
- 不确定文件是否存在时：优先只回 `text`，并让用户提供路径。

**你绝对不要做：**

- 不要凭空编造 `C:/xxx/xxx.png` 这种路径。
- 不要把超大文件内容直接塞进 `base64://`（会拖垮链路/模型输出）。

## 4. 失败模式（你需要允许失败并降级）

- 若 Bridge 未连接/断线：XRK-AGT 会拒绝发送或让 `pending` 全部失败。
- 若 120 秒未收到匹配 `id` 的回复：该请求超时失败。

**建议的 AI 降级策略：**

- 做不到媒体发送时：只发文字说明原因或让用户提供可用路径/URL。
- 避免长时间“憋大招”；能分步就分步，先给出可用的文字回应。

## 5. 与其他 SKILL 的分工

- `qq-chat`：告诉你如何用 `text/mediaUrls/files/to` 做“会话级回复”。
- `qq-media`：专门讲媒体字段与路径输入的注意事项。
- `xrk-screenshot`：讲如何生成本机截图文件，再交给 `mediaUrls` 发送。
- `xrk-bridge`（本文件）：讲“底层链路与边界”，用于你设计复杂流程（主动推送、异步、失败降级）时不踩坑。

