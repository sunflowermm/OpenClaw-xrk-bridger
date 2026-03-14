---
name: qq-chat
description: |
  给 AI 用的 QQ 回复说明。通过 XRK 通道把文字、图片、视频、音频、文件发回 QQ，并可选指定目标会话。
---

# QQ 聊天回复（给 AI）

## 你能做什么

- 只输出文字 → 自动发到**当前 QQ 会话**。
- 输出对象 `{ text, mediaUrls?, files?, to? }` → 按字段发文字、图片、视频、音频、文件，并可指定目标。

## 回复对象格式

```json
{
  "text": "回复内容",
  "mediaUrls": ["C:/path/to/image.png"],
  "files": [
    { "url": "C:/path/to/视频.mp4", "name": "介绍.mp4" },
    { "url": "C:/path/to/报告.pptx", "name": "报告.pptx" }
  ],
  "to": "group:123456789"
}
```

- **text**：发到 QQ 的文字。
- **mediaUrls**：图片路径数组（见 qq-media）。
- **files**：文件数组，每项 `{ url, name? }`；可包含视频、音频、办公文档等，通道会按类型正确发送并尽量保留文件名。
- **to**：可选。不写则回复当前会话；写则私聊 `"user:QQ号"`、群聊 `"group:群号"`。

## 不要做

- 不要编造不存在的 QQ 号/群号；不要在不明确上下文时乱改 `to`。
