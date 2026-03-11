import path from "node:path";
import fs from "node:fs";
import type { ChannelPlugin } from "openclaw/plugin-sdk";
import { getXrkRuntime } from "./runtime.js";
import { XrkBridgeClient, type XrkInboundMessage } from "./client.js";

export type ResolvedXrkAccount = {
  accountId: string;
  name?: string;
  enabled?: boolean;
  configured?: boolean;
  config: {
    wsUrl: string;
    accessToken?: string;
    name?: string;
    enabled?: boolean;
  };
  client?: XrkBridgeClient;
};

const DEFAULT_ACCOUNT_ID = "default";
const clients = new Map<string, XrkBridgeClient>();
/** 每个账号最近一次入站对应的发送目标，用于将 xrk-agt:bot 解析为当前会话 */
const lastToByAccount = new Map<string, string>();

const STATE_DIR = process.env.OPENCLAW_STATE_DIR || path.join(process.cwd(), ".openclaw", "state");
const LAST_TO_FILE = path.join(STATE_DIR, "xrk-bridger-last-to.json");
const LAST_SELF_ID_FILE = path.join(STATE_DIR, "xrk-bridger-last-selfid.json");

function loadLastToFromFile(): Record<string, string> {
  try {
    const s = fs.readFileSync(LAST_TO_FILE, "utf8");
    return JSON.parse(s) as Record<string, string>;
  } catch {
    return {};
  }
}

function saveLastToToFile(data: Record<string, string>) {
  try {
    fs.mkdirSync(path.dirname(LAST_TO_FILE), { recursive: true });
    fs.writeFileSync(LAST_TO_FILE, JSON.stringify(data));
  } catch (e) {
    console.warn("[XRK-Bridge] could not persist lastTo:", (e as Error)?.message);
  }
}

function resolveTo(to: string, accountId: string): { resolved: string; error?: string } {
  const aid = accountId || DEFAULT_ACCOUNT_ID;
  if (to === "xrk-agt:bot" || to.startsWith("xrk-agt:bot:")) {
    let last = lastToByAccount.get(aid);
    if (!last) {
      const fromFile = loadLastToFromFile()[aid];
      if (fromFile) {
        last = fromFile;
        lastToByAccount.set(aid, last);
      }
    }
    if (last) return { resolved: last };
    return { resolved: "", error: "Unknown target \"xrk-agt:bot\" for XRK-AGT Bridge. Send a message from QQ first, or specify to: user:QQ or group:ID." };
  }
  if (!to.includes(":") && /^\d+$/.test(to.trim())) return { resolved: `user:${to.trim()}` };
  return { resolved: to };
}

function resolveAccountConfig(cfg: any, accountId?: string): ResolvedXrkAccount {
  const id = accountId ?? DEFAULT_ACCOUNT_ID;
  const xrk = cfg.channels?.["xrk-agt"];
  const accountConfig = id === DEFAULT_ACCOUNT_ID ? xrk : xrk?.accounts?.[id];

  return {
    accountId: id,
    name: accountConfig?.name ?? "XRK-AGT Bridge",
    enabled: true,
    configured: Boolean(accountConfig?.wsUrl),
    config: {
      wsUrl: accountConfig?.wsUrl ?? "",
      accessToken: accountConfig?.accessToken,
      name: accountConfig?.name,
      enabled: accountConfig?.enabled,
    },
  };
}

function getClientForAccount(accountId: string): XrkBridgeClient | null {
  const existing = clients.get(accountId);
  if (existing) return existing;

  const runtime = getXrkRuntime();
  const cfg = runtime.config.loadConfig();
  const resolved = resolveAccountConfig(cfg, accountId);
  const wsUrl: string | undefined = resolved.config.wsUrl;
  const accessToken: string | undefined = resolved.config.accessToken;

  if (!wsUrl) return null;

  const client = new XrkBridgeClient({ wsUrl, accessToken });
  client.on("connect", () => {
    // eslint-disable-next-line no-console
    console.log(`[XRK-AGT] Bridge connected for account ${accountId}`);
  });
  client.on("disconnect", () => {
    // eslint-disable-next-line no-console
    console.log(`[XRK-AGT] Bridge disconnected for account ${accountId}`);
  });
  client.connect();
  clients.set(accountId, client);
  return client;
}

async function handleInboundFromXrk(
  accountId: string,
  event: XrkInboundMessage,
) {
  const runtime = getXrkRuntime();
  const cfg = runtime.config.loadConfig();
  const isGroup = event.kind === "group";
  const fromId = isGroup ? String(event.groupId) : String(event.userId);
  const deliveryTo = isGroup
    ? `group:${event.groupId}`
    : `user:${event.userId}`;
  lastToByAccount.set(accountId, deliveryTo);
  const persisted = loadLastToFromFile();
  persisted[accountId] = deliveryTo;
  saveLastToToFile(persisted);
  if (event.selfId) {
    try {
      const selfIdData: Record<string, string> = (() => {
        try {
          return JSON.parse(fs.readFileSync(LAST_SELF_ID_FILE, "utf8"));
        } catch {
          return {};
        }
      })();
      selfIdData[accountId] = event.selfId;
      fs.mkdirSync(path.dirname(LAST_SELF_ID_FILE), { recursive: true });
      fs.writeFileSync(LAST_SELF_ID_FILE, JSON.stringify(selfIdData));
    } catch {
      /* ignore */
    }
  }

  const text = (event.text || "").trim();
  const mediaUrls = event.mediaUrls || [];
  const files = event.files || [];
  if (!text && mediaUrls.length === 0 && files.length === 0) return;

  const sessionLabel = isGroup
    ? `XRK Group ${event.groupId}`
    : `XRK User ${event.userId}`;

  const route = runtime.channel.routing.resolveAgentRoute({
    cfg,
    channel: "xrk-agt",
    accountId,
    peer: {
      kind: isGroup ? "group" : "direct",
      id: fromId,
    },
  });

  const deliver = async (payload: any) => {
    const client = getClientForAccount(accountId);
    if (!client) return;

    console.log('[XRK-Bridge] deliver called, payload:', JSON.stringify(payload).substring(0, 200));

    const outMediaUrls: string[] = [];
    const outFiles: { url: string; name?: string }[] = [];
    const fs = await import('fs');

    const processUrl = async (url: string) => {
      if (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('base64://')) {
        return url;
      }
      const filePath = url.replace(/^file:\/\/+/i, "").replace(/^\/([A-Za-z]:)/, "$1");
      console.log('[XRK-Bridge] converting file to base64:', filePath);
      if (fs.existsSync(filePath)) {
        const buffer = fs.readFileSync(filePath);
        const base64 = buffer.toString('base64');
        console.log('[XRK-Bridge] base64 length:', base64.length);
        return `base64://${base64}`;
      }
      console.log('[XRK-Bridge] file not found:', filePath);
      return null;
    };

    if (payload.files && Array.isArray(payload.files)) {
      for (const f of payload.files) {
        if (f.url) {
          const processed = await processUrl(f.url);
          if (!processed) continue;

          const source = f.name || f.url;
          const ext = path.extname(source).toLowerCase();
          const isImageLike = [
            '.png',
            '.jpg',
            '.jpeg',
            '.gif',
            '.webp',
            '.bmp',
            '.svg',
            '.heic',
            '.heif',
            '.avif',
          ].includes(ext);

          if (isImageLike) {
            outMediaUrls.push(processed);
          } else {
            outFiles.push({ url: processed, name: f.name });
          }
        }
      }
    }

    if (payload.mediaUrls && Array.isArray(payload.mediaUrls)) {
      for (const url of payload.mediaUrls) {
        const originalPath = url.replace(/^file:\/\/+/i, "").replace(/^\/([A-Za-z]:)/, "$1");
        const processed = await processUrl(url);
        if (!processed) continue;

        const ext = path.extname(originalPath).toLowerCase();
        const isImageLike = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg', '.heic', '.heif', '.avif'].includes(ext);

        if (isImageLike || !ext) {
          outMediaUrls.push(processed);
        } else {
          const fileName = path.basename(originalPath);
          outFiles.push({ url: processed, name: fileName });
        }
      }
    }

    if (outMediaUrls.length === 0 && mediaUrls.length > 0) {
      console.log('[XRK-Bridge] echoing user images');
      outMediaUrls.push(...mediaUrls);
    }

    console.log('[XRK-Bridge] sending', outMediaUrls.length, 'media files and', outFiles.length, 'attachments');

    if (!payload.text && outMediaUrls.length === 0 && outFiles.length === 0) return;

    client.sendReply({
      id: (event as any).id,
      selfId: event.selfId,
      to: {
        kind: isGroup ? "group" as const : "direct" as const,
        userId: event.userId,
        groupId: event.groupId,
        selfId: event.selfId,
      },
      text: payload.text,
      mediaUrls: outMediaUrls,
      files: outFiles.length ? outFiles : undefined,
    });
  };

  const { dispatcher, replyOptions } =
    runtime.channel.reply.createReplyDispatcherWithTyping({ deliver });

  const ctxPayload = runtime.channel.reply.finalizeInboundContext({
    Provider: "xrk-agt",
    Channel: "xrk-agt",
    From: fromId,
    To: "xrk-agt:bot",
    Body: text,
    RawBody: text,
    SenderId: String(event.userId),
    SenderName: String(event.userId),
    ConversationLabel: sessionLabel,
    ThreadLabel: sessionLabel,
    SessionKey: route.sessionKey,
    AccountId: route.accountId,
    ChatType: isGroup ? "group" : "direct",
    Timestamp: Date.now(),
    Surface: "xrk-agt",
    OriginatingChannel: "xrk-agt",
    OriginatingTo: deliveryTo,
    CommandAuthorized: true,
    ...(mediaUrls.length > 0 && { MediaUrls: mediaUrls }),
    ...(files.length > 0 && { Files: files }),
  });

  await runtime.channel.session.recordInboundSession({
    storePath: runtime.channel.session.resolveStorePath(cfg.session?.store, {
      agentId: route.agentId,
    }),
    sessionKey: ctxPayload.SessionKey!,
    ctx: ctxPayload,
    updateLastRoute: undefined,
    onRecordError: (err: any) => console.error("XRK Session Error:", err),
  });

  // 使用官方 runtime 的统一派发方法，让 Agent 根据 cfg/ctx 生成回复，
  // 并通过我们上面的 deliver 回调发回 XRK。
  await runtime.channel.reply.dispatchReplyFromConfig({
    ctx: ctxPayload,
    cfg,
    dispatcher,
    replyOptions,
  });
}

const XrkChannelConfigSchema: ChannelPlugin["configSchema"] = {
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      wsUrl: {
        type: "string",
        description:
          "XRK-AGT XrkBridge Tasker 的 WebSocket 地址，例如 ws://127.0.0.1:11451/XrkBridge",
      },
      accessToken: {
        type: "string",
        description:
          "可选鉴权 Token，将作为 Authorization 头发送给 XRK-AGT",
      },
    },
  },
};

export const xrkChannel: ChannelPlugin<
  ResolvedXrkAccount,
  { ok: boolean; error?: string }
> = {
  id: "xrk-agt",
  meta: {
    id: "xrk-agt",
    label: "XRK-AGT Bridge",
    selectionLabel: "XRK-AGT Bridge",
    docsPath: "/channels/xrk-agt",
    blurb: "通过 XRK-AGT 自定义 Tasker 转发事件。",
  },
  capabilities: {
    chatTypes: ["direct"],
    media: true,
  },
  // 频道配置 schema：用于 Gateway UI 渲染表单（channels.xrk-agt）
  configSchema: XrkChannelConfigSchema,
  config: {
    listAccountIds: (cfg: any) => {
      const xrk = cfg.channels?.["xrk-agt"];
      if (!xrk) return [];
      if (xrk.accounts) return Object.keys(xrk.accounts);
      return [DEFAULT_ACCOUNT_ID];
    },
    resolveAccount: (cfg: any, accountId?: string): ResolvedXrkAccount =>
      resolveAccountConfig(cfg, accountId),
    defaultAccountId: () => DEFAULT_ACCOUNT_ID,
    describeAccount: (acc: ResolvedXrkAccount) => ({
      accountId: acc.accountId,
      configured: acc.configured ?? false,
    }),
  },
  status: {
    async probeAccount({ account, timeoutMs }) {
      if (!account.config.wsUrl) {
        return { ok: false, error: "Missing wsUrl" };
      }

      // 已有运行中的客户端则认为连接正常
      const runningClient = clients.get(account.accountId);
      if (runningClient) {
        return { ok: true };
      }

      // 否则做一次轻量级连通性探测
      const client = new XrkBridgeClient({
        wsUrl: account.config.wsUrl,
        accessToken: account.config.accessToken,
      });

      return await new Promise<{ ok: boolean; error?: string }>((resolve) => {
        const timer = setTimeout(() => {
          client.disconnect();
          resolve({ ok: false, error: "Connection timeout" });
        }, timeoutMs || 5_000);

        client.on("connect", () => {
          clearTimeout(timer);
          client.disconnect();
          resolve({ ok: true });
        });

        client.on("error", (err) => {
          clearTimeout(timer);
          client.disconnect();
          resolve({ ok: false, error: String(err) });
        });

        client.connect();
      });
    },
    buildAccountSnapshot({ account, probe }) {
      const runningClient = clients.get(account.accountId);
      return {
        accountId: account.accountId,
        name: account.name,
        enabled: account.enabled,
        configured: account.configured,
        running: Boolean(runningClient),
        lastStartAt: null,
        lastError:
          probe && probe.ok === false ? probe.error ?? null : null,
        probe,
      };
    },
  },
  outbound: {
    deliveryMode: "direct" as const,
    sendText: async ({ to, text, accountId }) => {
      const client = getClientForAccount(accountId || DEFAULT_ACCOUNT_ID);
      if (!client) {
        return { channel: "xrk-agt", sent: false, error: "Client not connected", messageId: null };
      }

      const { resolved, error: resolveError } = resolveTo(to, accountId || DEFAULT_ACCOUNT_ID);
      if (resolveError) return { channel: "xrk-agt", sent: false, error: resolveError, messageId: null };
      const [kind, ...parts] = resolved.split(":");
      if (kind === "group" && parts.length > 0) {
        client.sendReply({
          id: Date.now().toString(),
          to: { kind: "group", userId: "", groupId: parts[0] },
          text,
        });
      } else if (kind === "user" && parts.length > 0) {
        client.sendReply({
          id: Date.now().toString(),
          to: { kind: "direct", userId: parts[0] },
          text,
        });
      } else {
        return { channel: "xrk-agt", sent: false, error: "Invalid target format (use user:QQ or group:ID)", messageId: null };
      }

      return { channel: "xrk-agt", sent: true, messageId: null };
    },
    sendMedia: async ({ to, text, mediaUrl, accountId }) => {
      const client = getClientForAccount(accountId || DEFAULT_ACCOUNT_ID);
      if (!client) {
        return { channel: "xrk-agt", sent: false, error: "Client not connected", messageId: null };
      }

      const { resolved, error: resolveError } = resolveTo(to, accountId || DEFAULT_ACCOUNT_ID);
      if (resolveError) return { channel: "xrk-agt", sent: false, error: resolveError, messageId: null };
      const [kind, ...parts] = resolved.split(":");
      const inputUrls = mediaUrl ? [mediaUrl] : [];
      const outMediaUrls: string[] = [];
      if (inputUrls.length > 0) {
        const fs = await import("fs");
        const processUrl = async (url: string) => {
          if (url.startsWith("http://") || url.startsWith("https://") || url.startsWith("base64://")) return url;
          const filePath = url.replace(/^file:\/\/+/i, "").replace(/^\/([A-Za-z]:)/, "$1");
          if (fs.existsSync(filePath)) {
            const buffer = fs.readFileSync(filePath);
            return `base64://${buffer.toString("base64")}`;
          }
          return null;
        };
        for (const url of inputUrls) {
          const p = await processUrl(url);
          if (p) outMediaUrls.push(p);
        }
      }
      const finalMediaUrls = outMediaUrls;
      let selfId: string | undefined;
      try {
        selfId = JSON.parse(fs.readFileSync(LAST_SELF_ID_FILE, "utf8"))[accountId || DEFAULT_ACCOUNT_ID];
      } catch {}

      if (kind === "group" && parts.length > 0) {
        client.sendReply({
          id: Date.now().toString(),
          selfId,
          to: { kind: "group", userId: "", groupId: parts[0], selfId },
          text,
          mediaUrls: finalMediaUrls,
        });
      } else if (kind === "user" && parts.length > 0) {
        client.sendReply({
          id: Date.now().toString(),
          selfId,
          to: { kind: "direct", userId: parts[0], selfId },
          text,
          mediaUrls: finalMediaUrls,
        });
      } else {
        return { channel: "xrk-agt", sent: false, error: "Invalid target format (use user:QQ or group:ID)", messageId: null };
      }

      return { channel: "xrk-agt", sent: true, messageId: null };
    },
  },
};

export function attachInboundHandlerForAccount(accountId: string) {
  const client = getClientForAccount(accountId);
  if (!client) return;
  client.on("message", (event: XrkInboundMessage) =>
    void handleInboundFromXrk(accountId, event),
  );
}

