import WebSocket from "ws";
import EventEmitter from "events";

export interface XrkBridgeClientOptions {
  wsUrl: string;
  accessToken?: string;
}

export interface XrkInboundMessage {
  type: "message";
  id: string;
  kind: "direct" | "group";
  selfId: string;
  userId: string;
  groupId?: string;
  text: string;
  mediaUrls?: string[];
  files?: { url: string; name?: string }[];
  raw?: any;
}

export interface XrkOutboundReply {
  id?: string;
  selfId?: string;
  to: {
    kind: "direct" | "group";
    userId: string;
    groupId?: string;
    selfId?: string;
  };
  text?: string;
  files?: { url: string; name?: string }[];
  mediaUrls?: string[];
}

/**
 * XRK Bridge WebSocket 客户端
 *
 * 职责：
 * - 作为 WebSocket 客户端连接 XRK-AGT 自定义 Tasker 暴露的 wsUrl；
 * - 接收 Tasker 转发的「简化事件」（XrkInboundMessage）；
 * - 将 OpenClaw 生成的回复（XrkOutboundReply）发回 XRK-AGT，由 Tasker 再转交给 QQ / 其它端。
 *
 * 注意：这里不关心 Napcat / OneBot 细节，所有协议转换都在 XRK 侧完成。
 */
export class XrkBridgeClient extends EventEmitter {
  private ws: any | null = null;
  private readonly options: XrkBridgeClientOptions;
  private reconnectTimer: any | null = null;
  private reconnectAttempts = 0;
  private readonly maxReconnectDelay = 60000;

  constructor(options: XrkBridgeClientOptions) {
    super();
    this.options = options;
  }

  connect() {
    this.cleanup();

    const headers: Record<string, string> = {};
    if (this.options.accessToken) {
      headers["Authorization"] = `Bearer ${this.options.accessToken}`;
    }

    try {
      this.ws = new WebSocket(this.options.wsUrl, { headers });

      this.ws.on("open", () => {
        this.reconnectAttempts = 0;
        this.emit("connect");
      });

      this.ws.on("message", data => {
        try {
          const payload = JSON.parse(String(data)) as XrkInboundMessage;
          if (payload && payload.type === "message") {
            this.emit("message", payload);
          }
        } catch {
          // 忽略非 JSON
        }
      });

      this.ws.on("close", () => {
        this.handleDisconnect();
      });

      this.ws.on("error", err => {
        if (this.listenerCount("error") > 0) {
          this.emit("error", err);
        }
        this.handleDisconnect();
      });
    } catch (err) {
      if (this.listenerCount("error") > 0) {
        this.emit("error", err as Error);
      }
      this.scheduleReconnect();
    }
  }

  disconnect() {
    this.cleanup();
  }

  sendReply(reply: XrkOutboundReply) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    const nMedia = reply.mediaUrls?.length ?? 0;
    const nFiles = reply.files?.length ?? 0;
    console.warn(
      `[XRK-Bridge] client.sendReply 发出 → XRK: text=${reply.text ? "有" : "无"} mediaUrls=${nMedia} files=${nFiles}${nFiles ? ` fileNames=[${(reply.files ?? []).map(f => f.name ?? "").join(", ")}]` : ""}`,
    );
    try {
      this.ws.send(JSON.stringify({ type: "reply", ...reply }));
    } catch {
      // 忽略单次失败，重连逻辑会单独处理
    }
  }

  private cleanup() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.removeAllListeners();
      if (
        this.ws.readyState === WebSocket.OPEN ||
        this.ws.readyState === WebSocket.CONNECTING
      ) {
        this.ws.terminate();
      }
      this.ws = null;
    }
  }

  private handleDisconnect() {
    this.cleanup();
    this.emit("disconnect");
    this.scheduleReconnect();
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) return;
    const delay = Math.min(
      1000 * Math.pow(2, this.reconnectAttempts),
      this.maxReconnectDelay,
    );
    this.reconnectAttempts += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }
}

