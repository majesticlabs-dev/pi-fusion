import { homedir } from "node:os";
import { join } from "node:path";

import { findProjectConfigPath, loadFusionConfig, type FusionConfig } from "../src/config.ts";
import { requestSubagentRpc, type EventBus } from "../src/rpc.ts";
import {
  buildFusionBuildWorkflow,
  buildFusionWorkflow,
  buildOpinionWorkflow,
  parseFusionInput,
} from "../src/workflows.ts";

type NoticeLevel = "info" | "warning" | "error";

interface CommandContext {
  cwd: string;
  isProjectTrusted(): boolean;
  modelRegistry: {
    find(provider: string, model: string): unknown;
    hasConfiguredAuth(model: unknown): boolean;
  };
  ui: {
    notify(message: string, level: NoticeLevel): void;
  };
}

interface CommandDefinition {
  description: string;
  handler(args: string, ctx: CommandContext): Promise<void> | void;
}

interface ExtensionApi {
  events: EventBus;
  registerCommand(name: string, definition: CommandDefinition): void;
}

interface RpcSpawnResult {
  text?: string;
  details?: {
    asyncId?: string;
    runId?: string;
  };
}

const USER_CONFIG_PATH = join(homedir(), ".pi", "agent", "pi-fusion.json");

function splitModel(spec: string): [provider: string, model: string] {
  const separator = spec.indexOf("/");
  return [spec.slice(0, separator), spec.slice(separator + 1)];
}

function validateModels(config: FusionConfig, ctx: CommandContext): void {
  for (const role of ["architect", "analyst", "builder"] as const) {
    const spec = config[role].model;
    const [provider, modelId] = splitModel(spec);
    const model = ctx.modelRegistry.find(provider, modelId);
    if (!model) throw new Error(`${role} model '${spec}' is not registered. Check it with pi --list-models.`);
    if (!ctx.modelRegistry.hasConfiguredAuth(model)) {
      throw new Error(`${role} model '${spec}' has no configured authentication. Use /login for ${provider}.`);
    }
  }
}

async function resolveConfig(ctx: CommandContext): Promise<{ config: FusionConfig; projectPath: string }> {
  const projectPath = await findProjectConfigPath(ctx.cwd);
  const config = await loadFusionConfig({
    userPath: USER_CONFIG_PATH,
    projectPath,
    projectTrusted: ctx.isProjectTrusted(),
  });
  validateModels(config, ctx);
  return { config, projectPath };
}

function runCommand(
  ctx: CommandContext,
  command: string,
  operation: () => Promise<void>,
): Promise<void> {
  return operation().catch((error) => {
    ctx.ui.notify(`pi-fusion /${command}: ${error instanceof Error ? error.message : String(error)}`, "error");
  });
}

async function spawnWorkflow(
  pi: ExtensionApi,
  ctx: CommandContext,
  command: string,
  workflow: object,
): Promise<void> {
  const result = await requestSubagentRpc<RpcSpawnResult>(
    pi.events,
    "spawn",
    { ...workflow, cwd: ctx.cwd, async: true },
  );
  const runId = result.details?.asyncId ?? result.details?.runId;
  ctx.ui.notify(
    `pi-fusion: /${command} started${runId ? ` (${runId})` : ""}. Track it in the subagent FleetView.`,
    "info",
  );
}

export default function registerPiFusion(pi: ExtensionApi): void {
  pi.registerCommand("fusion-config", {
    description: "Show the resolved pi-fusion agent models and efforts",
    handler: async (_args, ctx) => runCommand(ctx, "fusion-config", async () => {
      const { config, projectPath } = await resolveConfig(ctx);
      ctx.ui.notify(
        [
          `ARCHITECT ${config.architect.model}:${config.architect.effort}`,
          `ANALYST ${config.analyst.model}:${config.analyst.effort}`,
          `BUILDER ${config.builder.model}:${config.builder.effort}`,
          `user: ${USER_CONFIG_PATH}`,
          `project override: ${projectPath}`,
        ].join("\n"),
        "info",
      );
    }),
  });

  pi.registerCommand("opinion", {
    description: "Run independent read-only architect and analyst opinions",
    handler: async (args, ctx) => runCommand(ctx, "opinion", async () => {
      const task = args.trim();
      if (!task) {
        ctx.ui.notify("Usage: /opinion <request>", "warning");
        return;
      }
      const { config } = await resolveConfig(ctx);
      await spawnWorkflow(pi, ctx, "opinion", buildOpinionWorkflow(config, task));
    }),
  });

  pi.registerCommand("fusion", {
    description: "Fuse independent architect and analyst analyses: /fusion <request> [:: merge instruction]",
    handler: async (args, ctx) => runCommand(ctx, "fusion", async () => {
      const { task, instruction } = parseFusionInput(args);
      const { config } = await resolveConfig(ctx);
      await spawnWorkflow(pi, ctx, "fusion", buildFusionWorkflow(config, task, instruction));
    }),
  });

  pi.registerCommand("fusion-build", {
    description: "Architect plan, single-writer builder implementation, then read-only analyst review",
    handler: async (args, ctx) => runCommand(ctx, "fusion-build", async () => {
      const task = args.trim();
      if (!task) {
        ctx.ui.notify("Usage: /fusion-build <implementation request>", "warning");
        return;
      }
      const { config } = await resolveConfig(ctx);
      await spawnWorkflow(pi, ctx, "fusion-build", buildFusionBuildWorkflow(config, task));
    }),
  });
}
