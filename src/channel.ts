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

function resolveAccountConfig(cfg: any, accountId?: string): ResolvedXrkAccount {
  const id = accountId ?? DEFAULT_ACCOUNT_ID;
  // 频道级配置：channels.xrk-agt 或 channels.xrk-agt.accounts[accountId]
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
  const fromId = isGroup
    ? `xrk-group:${event.groupId ?? ""}:${event.userId}`
    : `xrk-direct:${event.userId}`;

  const text = (event.text || "").trim();
  if (!text) return;

  const sessionLabel = isGroup
    ? `XRK Group ${event.groupId} User ${event.userId}`
    : `XRK Direct ${event.userId}`;

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
    const files =
      payload.files?.map((f: any) => ({
        url: f.url,
        name: f.name,
      })) ?? [];
    if (!payload.text && files.length === 0) return;
    client.sendReply({
      id: (event as any).id,
      to: {
        kind: isGroup ? "group" as const : "direct" as const,
        userId: event.userId,
        groupId: event.groupId,
      },
      text: payload.text,
      files,
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
    SenderName: event.userId,
    ConversationLabel: sessionLabel,
    ThreadLabel: sessionLabel,
    SessionKey: route.sessionKey,
    AccountId: route.accountId,
    ChatType: isGroup ? "group" : "direct",
    Timestamp: Date.now(),
    Surface: "xrk-agt",
    OriginatingChannel: "xrk-agt",
    OriginatingTo: fromId,
    CommandAuthorized: true,
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
  // 频道配置解析：从 openclaw.json 的 channels.xrk-agt 读取 wsUrl/accessToken
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
  // Inbound：由 runtime 注入事件时调用（见 index.ts）
  // Outbound：暂不实现，交由 XRK-AGT 负责真正发消息到 QQ/其它端。
};

export function attachInboundHandlerForAccount(accountId: string) {
  const client = getClientForAccount(accountId);
  if (!client) return;
  client.on("message", (event: XrkInboundMessage) =>
    void handleInboundFromXrk(accountId, event),
  );
}

