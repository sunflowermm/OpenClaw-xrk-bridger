import { xrkChannel, attachInboundHandlerForAccount } from "./channel.js";
import { setXrkRuntime } from "./runtime.js";

const plugin = {
  id: "openclaw-xrk-bridger",
  name: "XRK-AGT Bridge",
  description: "通过 XRK-AGT 自定义 Tasker 转发事件的通道插件。",
  register(api: any) {
    setXrkRuntime(api.runtime);
    api.registerChannel({ plugin: xrkChannel });
    attachInboundHandlerForAccount("default");
  },
};

export default plugin;

