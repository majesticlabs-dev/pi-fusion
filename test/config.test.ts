import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { DEFAULT_CONFIG, findProjectConfigPath, loadFusionConfig, parseFusionConfig } from "../src/config.ts";

const completeConfig = {
  architect: { model: "provider/architect", effort: "high" },
  analyst: { model: "provider/analyst", effort: "xhigh" },
  builder: { model: "provider/builder", effort: "medium" },
} as const;

test("parseFusionConfig accepts complete agent-owned model and effort settings", () => {
  assert.deepEqual(parseFusionConfig(JSON.stringify(completeConfig), "test"), completeConfig);
});

test("parseFusionConfig rejects incomplete, unknown, or malformed settings", () => {
  const invalidConfigs: Array<[unknown, RegExp]> = [
    [{ architect: completeConfig.architect, builder: completeConfig.builder }, /analyst.*object/i],
    [{ ...completeConfig, extra: true }, /unknown field.*extra/i],
    [{ ...completeConfig, analyst: { ...completeConfig.analyst, extra: true } }, /unknown field.*analyst\.extra/i],
    [{ ...completeConfig, architect: { effort: "high" } }, /architect\.model.*provider\/model/i],
    [{ ...completeConfig, architect: { model: "architect", effort: "high" } }, /architect\.model.*provider\/model/i],
    [{ ...completeConfig, analyst: { model: "provider/analyst", effort: "extreme" } }, /analyst\.effort.*off.*max/i],
  ];

  for (const [value, expected] of invalidConfigs) {
    assert.throws(() => parseFusionConfig(JSON.stringify(value), "test"), expected);
  }
});

test("loadFusionConfig applies whole-file trusted project precedence", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-fusion-config-"));
  const userPath = join(root, "user.json");
  const projectPath = join(root, "project", ".pi", "pi-fusion.json");
  const userConfig = {
    architect: { model: "user/architect", effort: "low" },
    analyst: { model: "user/analyst", effort: "medium" },
    builder: { model: "user/builder", effort: "high" },
  } as const;
  const projectConfig = {
    architect: { model: "project/architect", effort: "high" },
    analyst: { model: "project/analyst", effort: "xhigh" },
    builder: { model: "project/builder", effort: "max" },
  } as const;
  await mkdir(join(root, "project", ".pi"), { recursive: true });
  await writeFile(userPath, JSON.stringify(userConfig));
  await writeFile(projectPath, JSON.stringify(projectConfig));

  assert.deepEqual(await loadFusionConfig({ userPath, projectPath, projectTrusted: true }), projectConfig);
  assert.deepEqual(await loadFusionConfig({ userPath, projectPath, projectTrusted: false }), userConfig);
});

test("a trusted project config does not read a lower-precedence user file", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-fusion-config-"));
  const userPath = join(root, "invalid-user.json");
  const projectPath = join(root, "project.json");
  await writeFile(userPath, JSON.stringify({ architectModel: "legacy/architect" }));
  await writeFile(projectPath, JSON.stringify(completeConfig));

  assert.deepEqual(await loadFusionConfig({ userPath, projectPath, projectTrusted: true }), completeConfig);
});

test("loadFusionConfig falls back to package defaults", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-fusion-config-"));
  assert.deepEqual(
    await loadFusionConfig({
      userPath: join(root, "missing-user.json"),
      projectPath: join(root, "missing-project.json"),
      projectTrusted: true,
    }),
    DEFAULT_CONFIG,
  );
});

test("findProjectConfigPath uses the nearest ancestor project override", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-fusion-project-"));
  const nested = join(root, "packages", "app", "src");
  const expected = join(root, ".pi", "pi-fusion.json");
  await mkdir(nested, { recursive: true });
  await mkdir(join(root, ".pi"));
  await writeFile(expected, JSON.stringify(DEFAULT_CONFIG));

  assert.equal(await findProjectConfigPath(nested), expected);
});
