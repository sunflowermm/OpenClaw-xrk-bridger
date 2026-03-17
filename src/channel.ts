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
/** 按入站 event.id 聚合 outbound（保证 text→媒体顺序，避免重复发送） */
const outboundBufferByInboundId = new Map<
  string,
  {
    firstAt: number;
    lastAt: number;
    text?: string;
    mediaUrls: string[];
    files: { url: string; name?: string }[];
    flushTimer: any | null;
    sent: boolean;
  }
>();

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

    /**
     * OpenClaw runtime 可能对同一条入站消息多次回调 deliver（分段产出：先图片、后文本，或文本重复）。
     * 如果我们“来一段发一段”，XRK/QQ 侧就会出现乱序（图片先到）与重复发送。
     *
     * 这里对同一条入站 event.id 做短窗口合并：
     * - 收到的 text/media/files 会聚合到一个 buffer
     * - 优先等待 text（若会出现），然后一次性把 text + 全部媒体发给 XRK
     * - 超时仍无 text，则仅发媒体（保持可用性）
     */
    const key = String((event as any).id || "");
    if (!key) return;

    const buf = outboundBufferByInboundId.get(key) ?? {
      firstAt: Date.now(),
      lastAt: Date.now(),
      text: undefined as string | undefined,
      mediaUrls: [] as string[],
      files: [] as { url: string; name?: string }[],
      flushTimer: null as any | null,
      sent: false,
    };
    buf.lastAt = Date.now();

    const IMAGE_EXTS = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg', '.heic', '.heif', '.avif'];

    const processFile = async (url: string, name?: string) => {
      const processed = await processUrl(url);
      if (!processed) return;
      const ext = path.extname(name || url).toLowerCase();
      if (IMAGE_EXTS.includes(ext)) {
        buf.mediaUrls.push(processed);
      } else {
        buf.files.push({ url: processed, name });
      }
    };

    if (payload.files) {
      for (const f of payload.files) {
        if (f.url) await processFile(f.url, f.name);
      }
    }

    if (payload.mediaUrls) {
      for (const url of payload.mediaUrls) {
        await processFile(url);
      }
    }

    // payload.text 可能会在后续回调才出现；这里先聚合，不直接发送
    if (typeof payload.text === "string" && payload.text.trim()) {
      buf.text = payload.text;
    }

    // 兜底：如果 runtime 从未把媒体挂在 payload 上，则保留入站媒体
    if (!buf.mediaUrls.length && mediaUrls.length) buf.mediaUrls.push(...mediaUrls);

    // 去重（避免同一个 url/name 被重复 append）
    buf.mediaUrls = Array.from(new Set(buf.mediaUrls));
    const fileKey = (f: { url: string; name?: string }) => `${f.url}::${f.name ?? ""}`;
    const fileMap = new Map<string, { url: string; name?: string }>();
    for (const f of buf.files) fileMap.set(fileKey(f), f);
    buf.files = Array.from(fileMap.values());

    outboundBufferByInboundId.set(key, buf);

    const flush = () => {
      const current = outboundBufferByInboundId.get(key);
      if (!current || current.sent) return;

      const now = Date.now();
      const hasText = Boolean(current.text && String(current.text).trim());
      const hasMedia = (current.mediaUrls?.length ?? 0) > 0 || (current.files?.length ?? 0) > 0;
      if (!hasText && !hasMedia) return;

      // 等一等 text：若先到媒体、后到文本，则保证“文本→图片”顺序
      const WAIT_TEXT_MS = 800;
      if (!hasText && hasMedia && now - current.firstAt < WAIT_TEXT_MS) {
        current.flushTimer = setTimeout(flush, 120);
        return;
      }

      current.sent = true;
      outboundBufferByInboundId.set(key, current);
      client.sendReply({
        id: (event as any).id,
        selfId: event.selfId,
        to: {
          kind: isGroup ? "group" as const : "direct" as const,
          userId: event.userId,
          groupId: event.groupId,
          selfId: event.selfId,
        },
        text: current.text,
        mediaUrls: current.mediaUrls.length ? current.mediaUrls : undefined,
        files: current.files.length ? current.files : undefined,
      });

      // 清理 buffer，防止长期积累
      setTimeout(() => outboundBufferByInboundId.delete(key), 10_000);
    };

    if (buf.flushTimer) clearTimeout(buf.flushTimer);
    // 小窗口合并：给 runtime 一个机会把 text 与多张图一并送进来
    buf.flushTimer = setTimeout(flush, 180);
    outboundBufferByInboundId.set(key, buf);
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

export function attachInboundHandlerForAccount(accountId: string) {
  const client = getClientForAccount(accountId);
  if (!client) return;
  // 该插件可能在热重载/重复 register 时被多次调用；如果不去重，会叠加 message 监听器，
  // 导致同一条 XRK 入站消息被处理多次（表现为 client.sendReply 连续发出两次）。
  // 这里按账号确保只挂一个监听器。
  const existing = inboundHandlerByAccount.get(accountId);
  if (existing) client.off("message", existing);
  const handler = (event: XrkInboundMessage) => void handleInboundFromXrk(accountId, event);
  inboundHandlerByAccount.set(accountId, handler);
  client.on("message", handler);
}

const inboundHandlerByAccount = new Map<string, (event: XrkInboundMessage) => void>();

