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

test("extension registers native commands and routes project-configured models", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-fusion-extension-"));
  await mkdir(join(root, ".pi"));
  await writeFile(join(root, ".pi", "pi-fusion.json"), JSON.stringify({
    architectModel: "project/architect",
    builderModel: "project/builder",
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
  const ctx = {
    cwd: root,
    isProjectTrusted: () => true,
    modelRegistry: {
      find: () => ({ id: "model" }),
      hasConfiguredAuth: () => true,
    },
    ui: {
      notify(message: string, level: string) {
        notices.push({ message, level });
      },
    },
  };

  await commands.get("opinion")!.handler("Review this", ctx);
  const tasks = events.spawnParams?.tasks as Array<{ model: string }>;
  assert.deepEqual(tasks.map((task) => task.model), ["project/architect", "project/builder"]);
  assert.equal(events.spawnParams?.cwd, root);
  assert.ok(notices.some((notice) => notice.level === "info" && /started/i.test(notice.message)));
});
