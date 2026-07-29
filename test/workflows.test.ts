import assert from "node:assert/strict";
import test from "node:test";

import {
  AGENTS,
  buildFusionWorkflow,
  buildFusionBuildWorkflow,
  buildOpinionWorkflow,
  parseFusionInput,
  type WorkflowConfig,
} from "../src/workflows.ts";

const config: WorkflowConfig = {
  architectModel: "models/architect",
  builderModel: "models/builder",
};

test("opinion runs both models through the enforced read-only analyst", () => {
  const workflow = buildOpinionWorkflow(config, "Review the API");
  assert.equal(workflow.tasks.length, 2);
  assert.deepEqual(workflow.tasks.map((task) => task.agent), [AGENTS.analyst, AGENTS.analyst]);
  assert.deepEqual(workflow.tasks.map((task) => task.model), [config.architectModel, config.builderModel]);
  assert.equal(workflow.context, "fresh");
  assert.equal(workflow.async, true);
});

test("fusion uses read-only parallel analysis followed by architect synthesis", () => {
  const workflow = buildFusionWorkflow(config, "Design caching", "Prefer the simplest safe design");
  assert.equal(workflow.chain.length, 2);
  const parallel = workflow.chain[0].parallel;
  assert.ok(Array.isArray(parallel));
  assert.deepEqual(parallel.map((task) => task.agent), [AGENTS.analyst, AGENTS.analyst]);
  assert.deepEqual(parallel.map((task) => task.model), [config.architectModel, config.builderModel]);
  assert.equal(workflow.chain[1].agent, AGENTS.architect);
  assert.equal(workflow.chain[1].model, config.architectModel);
  assert.match(workflow.chain[1].task!, /\{outputs\.architect\}/);
  assert.match(workflow.chain[1].task!, /\{outputs\.builder\}/);
});

test("fusion-build has exactly one mutation-capable role", () => {
  const workflow = buildFusionBuildWorkflow(config, "Implement caching");
  const agents = workflow.chain.map((step) => step.agent);
  assert.deepEqual(agents, [AGENTS.architect, AGENTS.builder, AGENTS.architect]);
  assert.equal(agents.filter((agent) => agent === AGENTS.builder).length, 1);
  assert.equal(workflow.chain[1].model, config.builderModel);
  assert.equal(workflow.chain[1].acceptance, "checked");
});

test("fusion input supports an optional explicit merge instruction", () => {
  assert.deepEqual(parseFusionInput("Design caching"), {
    task: "Design caching",
    instruction: "Critically merge both analyses into one definitive answer.",
  });
  assert.deepEqual(parseFusionInput("Design caching :: Minimize operational complexity"), {
    task: "Design caching",
    instruction: "Minimize operational complexity",
  });
  assert.throws(() => parseFusionInput(" :: instruction"), /task is required/i);
});
