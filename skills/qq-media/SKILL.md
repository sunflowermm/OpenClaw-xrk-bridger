---
name: qq-media
description: |
  给 AI 用的 QQ 媒体发送说明。在回复里用 mediaUrls/files 发图片和文件，路径由 bridger 处理。
---

# 发送 QQ 媒体（给 AI）

## 字段

- 图片：`"mediaUrls": ["C:/path/to/image.png"]`
- 文件：`"files": [{ "url": "C:/path/to/doc.pdf", "name": "文档.pdf" }]`
- 多图+多文件：同时写 `mediaUrls` 与 `files` 数组即可。

## 路径与类型

- 支持：本机绝对路径、`file://`、`http(s)://`、`base64://`。bridger 会按扩展名或内容识别图片/文件并转成 QQ 可发格式。
- 不要编造本机路径；不确定时让用户提供路径，或只回文字。
