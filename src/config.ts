import { access, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

export const EFFORT_LEVELS = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const;

export type Effort = (typeof EFFORT_LEVELS)[number];
export type FusionRole = "architect" | "analyst" | "builder";

export interface FusionAgentConfig {
  model: string;
  effort: Effort;
}

export interface FusionConfig {
  architect: FusionAgentConfig;
  analyst: FusionAgentConfig;
  builder: FusionAgentConfig;
}

export const DEFAULT_CONFIG: Readonly<FusionConfig> = Object.freeze({
  architect: Object.freeze({ model: "claude-bridge/claude-opus-5", effort: "high" }),
  analyst: Object.freeze({ model: "openai-codex/gpt-5.6-sol", effort: "xhigh" }),
  builder: Object.freeze({ model: "openai-codex/gpt-5.6-sol", effort: "high" }),
});

const CONFIG_FIELDS = new Set<FusionRole>(["architect", "analyst", "builder"]);
const AGENT_FIELDS = new Set<keyof FusionAgentConfig>(["model", "effort"]);
const EFFORTS = new Set<string>(EFFORT_LEVELS);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isQualifiedModel(value: unknown): value is string {
  if (typeof value !== "string" || value.trim() !== value || /\s/.test(value)) return false;
  const separator = value.indexOf("/");
  return separator > 0 && separator < value.length - 1;
}

function parseAgentConfig(value: unknown, role: FusionRole, label: string): FusionAgentConfig {
  if (!isRecord(value)) throw new Error(`${label}: ${role} must be an object with model and effort.`);

  for (const field of Object.keys(value)) {
    if (!AGENT_FIELDS.has(field as keyof FusionAgentConfig)) {
      throw new Error(`${label}: unknown field '${role}.${field}'.`);
    }
  }

  if (!isQualifiedModel(value.model)) {
    throw new Error(`${label}: ${role}.model must be a non-empty provider/model string.`);
  }
  if (typeof value.effort !== "string" || !EFFORTS.has(value.effort)) {
    throw new Error(`${label}: ${role}.effort must be one of ${EFFORT_LEVELS.join(", ")}.`);
  }

  return { model: value.model, effort: value.effort as Effort };
}

export function parseFusionConfig(source: string, label: string): FusionConfig {
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch (error) {
    throw new Error(`${label}: invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (!isRecord(parsed)) throw new Error(`${label}: configuration must be a JSON object.`);

  for (const field of Object.keys(parsed)) {
    if (!CONFIG_FIELDS.has(field as FusionRole)) {
      throw new Error(`${label}: unknown field '${field}'.`);
    }
  }

  return {
    architect: parseAgentConfig(parsed.architect, "architect", label),
    analyst: parseAgentConfig(parsed.analyst, "analyst", label),
    builder: parseAgentConfig(parsed.builder, "builder", label),
  };
}

export async function findProjectConfigPath(cwd: string): Promise<string> {
  const start = resolve(cwd);
  let current = start;

  while (true) {
    const candidate = join(current, ".pi", "pi-fusion.json");
    try {
      await access(candidate);
      return candidate;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }

    const parent = dirname(current);
    if (parent === current) return join(start, ".pi", "pi-fusion.json");
    current = parent;
  }
}

async function readOptionalConfig(path: string): Promise<FusionConfig | undefined> {
  try {
    return parseFusionConfig(await readFile(path, "utf8"), path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

export async function loadFusionConfig(options: {
  userPath: string;
  projectPath: string;
  projectTrusted: boolean;
}): Promise<FusionConfig> {
  if (options.projectTrusted) {
    const projectConfig = await readOptionalConfig(options.projectPath);
    if (projectConfig) return projectConfig;
  }

  return (await readOptionalConfig(options.userPath)) ?? {
    architect: { ...DEFAULT_CONFIG.architect },
    analyst: { ...DEFAULT_CONFIG.analyst },
    builder: { ...DEFAULT_CONFIG.builder },
  };
}
