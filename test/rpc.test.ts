import assert from "node:assert/strict";
import test from "node:test";

import { requestSubagentRpc, type EventBus } from "../src/rpc.ts";

class FakeBus implements EventBus {
  listeners = new Map<string, Set<(data: unknown) => void>>();
  requests: unknown[] = [];

  on(event: string, handler: (data: unknown) => void): () => void {
    const handlers = this.listeners.get(event) ?? new Set();
    handlers.add(handler);
    this.listeners.set(event, handlers);
    return () => handlers.delete(handler);
  }

  emit(event: string, data: unknown): void {
    if (event === "subagents:rpc:v1:request") {
      this.requests.push(data);
      const request = data as { requestId: string };
      queueMicrotask(() => this.emit(`subagents:rpc:v1:reply:${request.requestId}`, {
        version: 1,
        requestId: request.requestId,
        success: true,
        data: { text: "started" },
      }));
      return;
    }
    for (const handler of this.listeners.get(event) ?? []) handler(data);
  }
}

test("requestSubagentRpc sends a versioned async spawn request", async () => {
  const bus = new FakeBus();
  const result = await requestSubagentRpc(bus, "spawn", { agent: "worker", task: "work" }, { timeoutMs: 100 });
  assert.deepEqual(result, { text: "started" });
  assert.equal(bus.requests.length, 1);
  assert.match(JSON.stringify(bus.requests[0]), /"version":1/);
  assert.match(JSON.stringify(bus.requests[0]), /"source":\{"extension":"pi-fusion"\}/);
});

test("requestSubagentRpc surfaces structured RPC errors", async () => {
  const bus = new FakeBus();
  bus.emit = function (event: string, data: unknown): void {
    if (event === "subagents:rpc:v1:request") {
      const request = data as { requestId: string };
      queueMicrotask(() => FakeBus.prototype.emit.call(this, `subagents:rpc:v1:reply:${request.requestId}`, {
        version: 1,
        requestId: request.requestId,
        success: false,
        error: { code: "invalid_params", message: "bad workflow" },
      }));
      return;
    }
    FakeBus.prototype.emit.call(this, event, data);
  };

  await assert.rejects(
    requestSubagentRpc(bus, "spawn", {}, { timeoutMs: 100 }),
    /invalid_params: bad workflow/,
  );
});
