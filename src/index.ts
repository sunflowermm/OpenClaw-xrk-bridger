import { xrkChannel, attachInboundHandlerForAccount } from "./channel.js";
import { setXrkRuntime } from "./runtime.js";

const plugin = {
  id: "xrk-agt-bridge",
  name: "XRK-AGT Bridge",
  description: "通过 XRK-AGT 自定义 Tasker 转发事件的通道插件。",
  register(api: any) {
    setXrkRuntime(api.runtime);
    // 注册通道
    api.registerChannel({ plugin: xrkChannel });
    // 初始化默认账号的 XRK Bridge 客户端
    attachInboundHandlerForAccount("default");
  },
};

export default plugin;

