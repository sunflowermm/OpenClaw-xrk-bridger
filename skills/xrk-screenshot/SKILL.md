---
name: xrk-screenshot
description: |
  给 AI 用的截图说明。用脚本生成本地截图文件，再把路径放进 mediaUrls 发到 QQ。
---

# 截图并发到 QQ（给 AI）

## 流程

1. 用 Node 脚本调用 `screenshot-desktop` 截屏并保存到本地，得到文件路径。
2. 在回复里把该路径放进 `mediaUrls`，例如：`{ "text": "当前截图。", "mediaUrls": ["<脚本输出的路径>"] }`。
3. 扩展会读取文件并发到 QQ。

## 脚本示例

```javascript
const screenshot = require('screenshot-desktop');
const fs = require('fs');
const path = require('path');
(async () => {
  const img = await screenshot();
  const filePath = path.join(process.env.TEMP || '/tmp', `screenshot_${Date.now()}.png`);
  fs.writeFileSync(filePath, img);
  console.log(filePath);
})();
```

需先安装：`npm install screenshot-desktop`。路径必须来自脚本实际输出，不要虚构。
