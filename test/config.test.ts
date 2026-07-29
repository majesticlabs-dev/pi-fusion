import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { DEFAULT_CONFIG, findProjectConfigPath, loadFusionConfig, parseFusionConfig } from "../src/config.ts";

test("parseFusionConfig accepts exactly the two model fields", () => {
  assert.deepEqual(
    parseFusionConfig(JSON.stringify({ architectModel: "provider/architect", builderModel: "provider/builder" }), "test"),
    { architectModel: "provider/architect", builderModel: "provider/builder" },
  );
});

test("parseFusionConfig rejects unknown and malformed fields", () => {
  assert.throws(
    () => parseFusionConfig(JSON.stringify({ architectModel: "provider/a", builderModel: "provider/b", extra: true }), "test"),
    /unknown field.*extra/i,
  );
  assert.throws(
    () => parseFusionConfig(JSON.stringify({ architectModel: "a", builderModel: "provider/b" }), "test"),
    /architectModel.*provider\/model/i,
  );
});

test("loadFusionConfig applies trusted project override after user config", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-fusion-config-"));
  const userPath = join(root, "user.json");
  const projectPath = join(root, "project", ".pi", "pi-fusion.json");
  await mkdir(join(root, "project", ".pi"), { recursive: true });
  await writeFile(userPath, JSON.stringify({ architectModel: "user/architect", builderModel: "user/builder" }));
  await writeFile(projectPath, JSON.stringify({ architectModel: "project/architect", builderModel: "project/builder" }));

  assert.deepEqual(await loadFusionConfig({ userPath, projectPath, projectTrusted: true }), {
    architectModel: "project/architect",
    builderModel: "project/builder",
  });
  assert.deepEqual(await loadFusionConfig({ userPath, projectPath, projectTrusted: false }), {
    architectModel: "user/architect",
    builderModel: "user/builder",
  });
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
