---
name: xrk-channel
description: |
  给 AI 看的 XRK-AGT 通道使用说明。教你在 OpenClaw 里如何“通过 XRK 通道”与 QQ 用户对话。
---

# XRK-AGT 通道：AI 怎么用

你收到的消息来自 **XRK-AGT Bridge**：QQ 上的文字/图片/文件会先到 XRK-AGT（`core/Openclaw-Core/tasker/XrkBridge.js`），再通过 WebSocket 发给 OpenClaw，最后由扩展转成会话上下文交给你。

你的回复会由扩展打包成 `reply` 发回 XRK-AGT，再发到 QQ。你**只需要按下面格式输出**，不用管 WebSocket 或协议细节。

## 回复格式（发回 QQ）

- **只发文字**：直接输出字符串，或 `{ "text": "内容" }`。
- **文字 + 图片/文件**：输出对象，例如：

```json
{
  "text": "已处理，截图如下。",
  "mediaUrls": ["C:/path/to/screenshot.png"],
  "files": [{ "url": "C:/path/to/doc.pdf", "name": "说明.pdf" }]
}
```

- `text`：发到 QQ 的文字（可选）。
- `mediaUrls`：图片地址数组。支持本机路径、`http(s)://`、`base64://`；扩展会按需转成 QQ 可发的格式。
- `files`：文件数组，每项 `{ url, name? }`。支持视频、音频、办公文档等所有类型，通道会按类型正确发送并尽量保留文件名。路径规则同 `mediaUrls`。

**不要编造不存在的本机路径**；不确定时只回文字或让用户提供路径。详见 `qq-media`。

## 发给谁（To）

- **默认**：不写 `to` 时，回复会发到**当前这条消息所在的 QQ 会话**（群或私聊）。扩展会用“当前会话”的上下文。
- **指定对象**：需要主动发到某个群/某人时，用 `to`：
  - 私聊：`"to": "user:QQ号"`
  - 群聊：`"to": "group:群号"`

多数场景用默认即可；只有广播、定时通知等才需要写 `to`。详见 `qq-chat`。

## 你能拿到的上下文

- 消息来源：群或私聊、发送者 QQ、群号等会体现在会话信息里（如 ConversationLabel、OriginatingTo 等）。
- 若用户发了图片/文件，上下文中会带 `MediaUrls` / `Files`，你可据此理解内容后再用 `mediaUrls` / `files` 回图/回文件。

## 相关 SKILL

- **qq-chat**：回复字段与 `to` 的用法。
- **qq-media**：图片/文件的路径与禁忌。
- **xrk-screenshot**：先截图到本地，再把路径放进 `mediaUrls`。
- **xrk-bridge**：底层链路与超时、失败时的降级思路。
