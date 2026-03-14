---
name: qq-media
description: |
  给 AI 用的 QQ 媒体与文件发送说明。支持图片、视频、音频、办公文档等所有类型，路径由 bridger 与 XRK 统一处理。
---

# 发送 QQ 媒体与文件（给 AI）

## 支持的格式

- **图片**：`mediaUrls` 或 `files`，扩展名/内容为图片即可按图片发送。
- **视频**：`files` 中放 `{ url, name? }`，支持 mp4、webm、mov、avi、mkv 等，会按 QQ 视频段发送。
- **音频**：`files` 中放 `{ url, name? }`，支持 mp3、wav、m4a、ogg、flac 等，会按 QQ 语音段发送。
- **办公/其他**：`files` 中放 `{ url, name? }`，如 ppt/pptx、doc/docx、xls/xlsx、pdf 等，会按文件发送且尽量保留正确文件名。

## 字段与路径

- **mediaUrls**：`["C:/path/to/image.png"]`，多图可写多元素。
- **files**：`[{ "url": "C:/path/to/视频.mp4", "name": "视频.mp4" }]`，建议带 `name` 以便 QQ 显示正确文件名。
- 支持：本机绝对路径、`file://`、`http(s)://`、`base64://`。bridger 与 XRK 会按扩展名或内容识别类型并转成 QQ 可发格式。
- 不要编造本机路径；不确定时让用户提供路径，或只回文字。
