import { access, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

export interface FusionConfig {
  architectModel: string;
  builderModel: string;
}

export const DEFAULT_CONFIG: Readonly<FusionConfig> = Object.freeze({
  architectModel: "claude-bridge/claude-opus-4-8",
  builderModel: "openai-codex/gpt-5.6-sol",
});

const CONFIG_FIELDS = new Set<keyof FusionConfig>(["architectModel", "builderModel"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isQualifiedModel(value: unknown): value is string {
  if (typeof value !== "string" || value.trim() !== value || /\s/.test(value)) return false;
  const separator = value.indexOf("/");
  return separator > 0 && separator < value.length - 1;
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
    if (!CONFIG_FIELDS.has(field as keyof FusionConfig)) {
      throw new Error(`${label}: unknown field '${field}'.`);
    }
  }

  for (const field of CONFIG_FIELDS) {
    if (!isQualifiedModel(parsed[field])) {
      throw new Error(`${label}: ${field} must be a non-empty provider/model string.`);
    }
  }

  return {
    architectModel: parsed.architectModel as string,
    builderModel: parsed.builderModel as string,
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
  const userConfig = await readOptionalConfig(options.userPath);
  const projectConfig = options.projectTrusted
    ? await readOptionalConfig(options.projectPath)
    : undefined;

  return projectConfig ?? userConfig ?? { ...DEFAULT_CONFIG };
}
