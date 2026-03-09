/**
 * XRK Bridge 运行时注入点
 *
 * 模式与 openclaw_qq/src/runtime.ts 保持一致：
 * - OpenClaw Gateway 在加载插件时调用 setXrkRuntime(api.runtime)
 * - 通道实现通过 getXrkRuntime() 取得 runtime，并使用
 *   runtime.channel.routing / runtime.channel.reply / runtime.channel.session
 *   来完成入站消息的路由与回复。
 */

let runtime: any | null = null;

export function setXrkRuntime(next: any) {
  runtime = next;
}

export function getXrkRuntime(): any {
  if (!runtime) {
    throw new Error("XRK runtime not initialized");
  }
  return runtime;
}

