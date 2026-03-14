---
name: qq-chat
description: |
  QQ 回复：可发文字、图片、文件。发文件时用真实路径，底层会从路径推断文件名；建议同时传 name（与路径一致）以保持体验一致。
---

# QQ 聊天回复（给 AI）

## 你能做什么

- 只输出文字 → 自动发到**当前 QQ 会话**。
- 输出对象 `{ text, mediaUrls?, files?, to? }` → 发文字、图片、视频、音频、文件，并可指定目标。

## 发文件：路径真实 + 建议带 name

**回复里若有 `files`：**

- **url**：填真实本机路径（如 `C:\Users\...\xxx.pptx`）。底层会从路径推断文件名，QQ 会显示正确名称。
- **name**：建议填与路径末尾一致的真实文件名（用户看到的那个），便于多文件区分与后续体验一致。
- 正确示例（桌面两个 PPT 发回用户）：

```json
{
  "text": "这是您桌面上的两个 PPT：",
  "files": [
    { "url": "C:/Users/xxx/Desktop/Git 使用与验证原理.pptx", "name": "Git 使用与验证原理.pptx" },
    { "url": "C:/Users/xxx/Desktop/OpenClaw 部署与逻辑.pptx", "name": "OpenClaw 部署与逻辑.pptx" }
  ]
}
```

- 你从路径或目录里读到了什么文件名，`name` 就填什么（含后缀），不要改成“文件.pptx”或省略 name。

## 回复对象格式

- **text**：发到 QQ 的文字。
- **mediaUrls**：图片路径数组（见 qq-media）。
- **files**：文件数组，每项 `{ url, name? }`；url 为真实路径（底层会从路径推断显示名），name 建议填真实文件名。
- **to**：可选。不写则回复当前会话；写则私聊 `"user:QQ号"`、群聊 `"group:群号"`。

## 不要做

- 不要编造本机路径或 QQ 号/群号；不要用通用名如「文件.pptx」。
