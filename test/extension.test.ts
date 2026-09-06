import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import registerPiFusion from "../extensions/pi-fusion.ts";
import type { EventBus } from "../src/rpc.ts";

class RpcBus implements EventBus {
  listeners = new Map<string, Set<(data: unknown) => void>>();
  spawnParams: Record<string, unknown> | undefined;

  on(event: string, handler: (data: unknown) => void): () => void {
    const handlers = this.listeners.get(event) ?? new Set();
    handlers.add(handler);
    this.listeners.set(event, handlers);
    return () => handlers.delete(handler);
  }

  emit(event: string, data: unknown): void {
    if (event === "subagents:rpc:v1:request") {
      const request = data as { requestId: string; method: string; params: Record<string, unknown> };
      this.spawnParams = request.params;
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

const removedSpawnFields = ["tasks", "chain", "parallel", "concurrency", "clarify"];

test("extension routes configured model-effort pairs through the workflowScript spawn contract", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-fusion-extension-"));
  await mkdir(join(root, ".pi"));
  await writeFile(join(root, ".pi", "pi-fusion.json"), JSON.stringify({
    architect: { model: "project/architect", effort: "high" },
    analyst: { model: "project/analyst", effort: "xhigh" },
    builder: { model: "project/builder", effort: "medium" },
  }));

  const events = new RpcBus();
  const commands = new Map<string, { handler: (args: string, ctx: any) => Promise<void> | void }>();
  registerPiFusion({
    events,
    registerCommand(name, definition) {
      commands.set(name, definition);
    },
  });

  assert.deepEqual([...commands.keys()].sort(), ["fusion", "fusion-build", "fusion-config", "opinion"]);

  const notices: Array<{ message: string; level: string }> = [];
  const modelLookups: Array<[string, string]> = [];
  const ctx = {
    cwd: root,
    isProjectTrusted: () => true,
    modelRegistry: {
      find(provider: string, model: string) {
        modelLookups.push([provider, model]);
        return { id: model };
      },
      hasConfiguredAuth: () => true,
    },
    ui: {
      notify(message: string, level: string) {
        notices.push({ message, level });
      },
    },
  };

  await commands.get("fusion-config")!.handler("", ctx);
  assert.match(notices.at(-1)!.message, /ARCHITECT project\/architect:high/);
  assert.match(notices.at(-1)!.message, /ANALYST project\/analyst:xhigh/);
  assert.match(notices.at(-1)!.message, /BUILDER project\/builder:medium/);

  modelLookups.length = 0;
  await commands.get("opinion")!.handler("Review this", ctx);
  assert.deepEqual(modelLookups, [
    ["project", "architect"],
    ["project", "analyst"],
    ["project", "builder"],
  ]);
  assert.equal(typeof events.spawnParams?.workflowScript, "string");
  assert.equal(events.spawnParams?.cwd, root);
  assert.equal(events.spawnParams?.context, "fresh");
  assert.equal(events.spawnParams?.async, true);
  assert.equal(events.spawnParams?.artifacts, true);
  for (const field of removedSpawnFields) assert.equal(field in events.spawnParams!, false);

  const launched: Array<{ key: string; agent: string; model: string }> = [];
  const runs = {
    async all(items: Array<{ key: string; agent: string; model: string }>) {
      launched.push(...items);
      return items.map((item) => ({ output: `${item.key} output` }));
    },
  };
  const AsyncFunction = Object.getPrototypeOf(async () => undefined).constructor as new (
    ...args: string[]
  ) => (runsArgument: unknown) => Promise<unknown>;
  await new AsyncFunction("runs", events.spawnParams!.workflowScript as string)(runs);
  assert.deepEqual(launched.map(({ agent, model }) => ({ agent, model })), [
    { agent: "pi-fusion.architect", model: "project/architect:high" },
    { agent: "pi-fusion.analyst", model: "project/analyst:xhigh" },
  ]);
  assert.ok(notices.some((notice) => notice.level === "info" && /started/i.test(notice.message)));
});
