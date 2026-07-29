import { randomUUID } from "node:crypto";

const REQUEST_EVENT = "subagents:rpc:v1:request";
const REPLY_PREFIX = "subagents:rpc:v1:reply:";

export interface EventBus {
  on(event: string, handler: (data: unknown) => void): (() => void) | void;
  emit(event: string, data: unknown): void;
}

type RpcMethod = "ping" | "spawn" | "status" | "steer" | "interrupt" | "stop" | "resume";

interface RpcReply {
  version: 1;
  requestId: string;
  success: boolean;
  data?: unknown;
  error?: { code?: string; message?: string };
}

function isRpcReply(value: unknown, requestId: string): value is RpcReply {
  if (!value || typeof value !== "object") return false;
  const reply = value as Partial<RpcReply>;
  return reply.version === 1 && reply.requestId === requestId && typeof reply.success === "boolean";
}

export function requestSubagentRpc<T = unknown>(
  events: EventBus,
  method: RpcMethod,
  params: Record<string, unknown>,
  options: { timeoutMs?: number } = {},
): Promise<T> {
  const requestId = randomUUID();
  const replyEvent = `${REPLY_PREFIX}${requestId}`;
  const timeoutMs = options.timeoutMs ?? 10_000;

  return new Promise<T>((resolve, reject) => {
    let unsubscribe: (() => void) | undefined;
    const cleanup = () => {
      clearTimeout(timer);
      unsubscribe?.();
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`pi-subagents RPC '${method}' timed out. Confirm pi-subagents is installed and enabled.`));
    }, timeoutMs);

    const maybeUnsubscribe = events.on(replyEvent, (value) => {
      if (!isRpcReply(value, requestId)) return;
      cleanup();
      if (value.success) {
        resolve(value.data as T);
        return;
      }
      const code = value.error?.code ?? "rpc_error";
      const message = value.error?.message ?? "Unknown pi-subagents RPC error.";
      reject(new Error(`${code}: ${message}`));
    });
    if (typeof maybeUnsubscribe === "function") unsubscribe = maybeUnsubscribe;

    events.emit(REQUEST_EVENT, {
      version: 1,
      requestId,
      method,
      params,
      source: { extension: "pi-fusion" },
    });
  });
}
