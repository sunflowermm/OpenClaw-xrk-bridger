import path from "node:path";
import fs from "node:fs";
import type { ChannelPlugin } from "openclaw/plugin-sdk";
import { getXrkRuntime } from "./runtime.js";
import { XrkBridgeClient, type XrkInboundMessage } from "./client.js";

async function processUrl(url: string): Promise<string | null> {
  if (!url) return null;
  // 网络 URL 和 base64 直接返回
  if (url.startsWith("http://") || url.startsWith("https://") || url.startsWith("base64://")) {
    return url;
  }
  // 处理本地文件路径（支持 file:// 前缀和直接路径）
  let filePath = url;
  if (url.startsWith("file://")) {
    filePath = url.replace(/^file:\/\/+/i, "").replace(/^\/([A-Za-z]:)/, "$1");
  }
  // 尝试直接作为路径读取
  if (fs.existsSync(filePath)) {
    return `base64://${fs.readFileSync(filePath).toString("base64")}`;
  }
  return null;
}

/** 从 URL 推断默认文件名（仅当 agent 未提供 name 时用） */
function defaultFileNameFromUrl(url: string): string | undefined {
  if (!url || url.startsWith("base64://")) return undefined;
  try {
    if (url.startsWith("file://")) {
      const p = url.replace(/^file:\/\/+/i, "").replace(/^\/([A-Za-z]:)/, "$1");
      return path.basename(p) || undefined;
    }
    if (url.startsWith("http://") || url.startsWith("https://")) {
      const u = new URL(url);
      const segment = path.basename(u.pathname);
      return segment || undefined;
    }
  } catch {
    // ignore
  }
  return undefined;
}

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
/** 每个账号最近一次收到 XRK 入站消息的时间戳 */
const lastInboundAtByAccount = new Map<string, number>();
/** 每个账号当前 WebSocket 是否处于连接状态 */
const connectedByAccount = new Map<string, boolean>();

const STATE_DIR = process.env.OPENCLAW_STATE_DIR || path.join(process.cwd(), ".openclaw", "state");
const STATE_FILE = path.join(STATE_DIR, "xrk-bridger-state.json");

type StateData = {
  lastTo: Record<string, string>;
  lastInbound: Record<string, number>;
  lastSelfId: Record<string, string>;
};

function loadState(): StateData {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
  } catch {
    return { lastTo: {}, lastInbound: {}, lastSelfId: {} };
  }
}

function saveState(data: Partial<StateData>) {
  try {
    const current = loadState();
    const updated = { ...current, ...data };
    fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
    fs.writeFileSync(STATE_FILE, JSON.stringify(updated));
  } catch (e) {
    console.warn("[XRK-Bridge] persist failed:", (e as Error)?.message);
  }
}

function resolveTo(to: string, accountId: string): { resolved: string; error?: string } {
  const aid = accountId || DEFAULT_ACCOUNT_ID;
  if (to === "xrk-agt:bot" || to.startsWith("xrk-agt:bot:")) {
    const last = lastToByAccount.get(aid) || loadState().lastTo[aid];
    if (last) {
      lastToByAccount.set(aid, last);
      return { resolved: last };
    }
    return { resolved: "", error: "No active QQ session. Send a message first or use user:QQ/group:ID." };
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
    connectedByAccount.set(accountId, true);
  });
  client.on("disconnect", () => {
    // eslint-disable-next-line no-console
    console.log(`[XRK-AGT] Bridge disconnected for account ${accountId}`);
    connectedByAccount.set(accountId, false);
  });
  // 入站消息只在此处挂载一次，避免 register 多次执行时重复挂载导致一条消息触发多次 agent
  client.on("message", (event: XrkInboundMessage) =>
    void handleInboundFromXrk(accountId, event),
  );
  client.connect();
  clients.set(accountId, client);
  return client;
}

async function handleInboundFromXrk(accountId: string, event: XrkInboundMessage) {
  const now = Date.now();
  lastInboundAtByAccount.set(accountId, now);

  const isGroup = event.kind === "group";
  const deliveryTo = isGroup ? `group:${event.groupId}` : `user:${event.userId}`;
  lastToByAccount.set(accountId, deliveryTo);

  const state = loadState();
  state.lastInbound[accountId] = now;
  state.lastTo[accountId] = deliveryTo;
  if (event.selfId) state.lastSelfId[accountId] = event.selfId;
  saveState(state);

  const runtime = getXrkRuntime();
  const cfg = runtime.config.loadConfig();
  const fromId = isGroup ? String(event.groupId) : String(event.userId);

  const text = (event.text || "").trim();
  const mediaUrls = event.mediaUrls || [];
  const files = event.files || [];
  if (!text && !mediaUrls.length && !files.length) return;

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

    const IMAGE_EXTS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".svg", ".heic", ".heif", ".avif"]);
    const outMediaUrls: string[] = [];
    const outFiles: { url: string; name?: string }[] = [];

    const items: { url: string; name?: string }[] = [
      ...(payload.files?.filter((f: any) => f.url).map((f: any) => ({ url: f.url, name: f.name })) ?? []),
      ...(payload.mediaUrls?.map((url: string) => ({ url })) ?? []),
    ];
    for (const { url, name } of items) {
      const processed = await processUrl(url);
      if (!processed) continue;
      const resolvedName = name?.trim() || defaultFileNameFromUrl(url);
      const ext = path.extname(resolvedName || url).toLowerCase();
      if (IMAGE_EXTS.has(ext)) outMediaUrls.push(processed);
      else outFiles.push({ url: processed, name: resolvedName || undefined });
    }

    if (!outMediaUrls.length && mediaUrls.length) outMediaUrls.push(...mediaUrls);
    if (!payload.text && !outMediaUrls.length && !outFiles.length) return;

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
      const state = loadState();
      const lastInboundAt = lastInboundAtByAccount.get(account.accountId) || state.lastInbound[account.accountId] || null;
      if (lastInboundAt) lastInboundAtByAccount.set(account.accountId, lastInboundAt);

      const connected = connectedByAccount.get(account.accountId) ?? (Boolean(runningClient) || (probe?.ok ?? false));
      return {
        accountId: account.accountId,
        name: account.name,
        enabled: account.enabled,
        configured: account.configured,
        running: Boolean(runningClient),
        connected,
        lastInboundAt,
        lastStartAt: null,
        lastError: probe?.ok === false ? probe.error ?? null : null,
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
      if (!client) return { channel: "xrk-agt", sent: false, error: "Client not connected", messageId: null };

      const { resolved, error: resolveError } = resolveTo(to, accountId || DEFAULT_ACCOUNT_ID);
      if (resolveError) return { channel: "xrk-agt", sent: false, error: resolveError, messageId: null };

      const [kind, ...parts] = resolved.split(":");
      const outMediaUrls: string[] = [];

      if (mediaUrl) {
        const processed = await processUrl(mediaUrl);
        if (processed) outMediaUrls.push(processed);
      }

      const selfId = loadState().lastSelfId[accountId || DEFAULT_ACCOUNT_ID];
      const toData = kind === "group" && parts.length > 0
        ? { kind: "group" as const, userId: "", groupId: parts[0], selfId }
        : kind === "user" && parts.length > 0
        ? { kind: "direct" as const, userId: parts[0], selfId }
        : null;

      if (!toData) return { channel: "xrk-agt", sent: false, error: "Invalid target format (use user:QQ or group:ID)", messageId: null };

      client.sendReply({ id: Date.now().toString(), selfId, to: toData, text, mediaUrls: outMediaUrls });
      return { channel: "xrk-agt", sent: true, messageId: null };
    },
  },
};

/** 确保指定账号的 XRK 客户端存在（入站监听在创建 client 时已挂载，此处仅触发创建） */
export function attachInboundHandlerForAccount(accountId: string) {
  getClientForAccount(accountId);
}

