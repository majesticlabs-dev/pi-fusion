import assert from "node:assert/strict";
import test from "node:test";

import {
  AGENTS,
  buildFusionWorkflow,
  buildFusionBuildWorkflow,
  buildOpinionWorkflow,
  parseFusionInput,
  type WorkflowConfig,
  type WorkflowRequest,
} from "../src/workflows.ts";

const config: WorkflowConfig = {
  architect: { model: "models/architect", effort: "high" },
  analyst: { model: "models/analyst", effort: "xhigh" },
  builder: { model: "models/builder", effort: "medium" },
};

interface ChildParams {
  agent: string;
  task: string;
  model: string;
  acceptance?: string;
  agentContract?: { version: number };
}

interface RunEvent {
  kind: "run";
  key: string;
  params: ChildParams;
}

interface AllEvent {
  kind: "all";
  items: Array<ChildParams & { key: string }>;
}

type WorkflowEvent = RunEvent | AllEvent;

async function executeWorkflow(
  workflow: WorkflowRequest,
  outputs: Record<string, string>,
): Promise<{ result: unknown; events: WorkflowEvent[] }> {
  const events: WorkflowEvent[] = [];
  const runs = {
    async run(key: string, params: ChildParams) {
      events.push({ kind: "run" as const, key, params });
      return { output: outputs[key] ?? `${key} output` };
    },
    async all(items: Array<ChildParams & { key: string }>) {
      events.push({ kind: "all" as const, items });
      return items.map((item) => ({ output: outputs[item.key] ?? `${item.key} output` }));
    },
  };
  const AsyncFunction = Object.getPrototypeOf(async () => undefined).constructor as new (
    ...args: string[]
  ) => (runsArgument: unknown) => Promise<unknown>;
  const result = await new AsyncFunction("runs", workflow.workflowScript)(runs);
  return { result, events };
}

test("opinion executes architect and analyst concurrently and returns both outputs", async () => {
  const workflow = buildOpinionWorkflow(config, "Review the API");
  const { result, events } = await executeWorkflow(workflow, {
    architect: "architect opinion",
    analyst: "analyst opinion",
  });

  assert.equal(events.length, 1);
  assert.equal(events[0].kind, "all");
  if (events[0].kind !== "all") return;
  assert.deepEqual(events[0].items.map((item) => item.agent), [AGENTS.architect, AGENTS.analyst]);
  assert.deepEqual(events[0].items.map((item) => item.model), ["models/architect:high", "models/analyst:xhigh"]);
  assert.deepEqual(result, ["architect opinion", "analyst opinion"]);
  assert.equal(workflow.context, "fresh");
  assert.equal(workflow.async, true);
});

test("fusion executes independent analysis before architect synthesis", async () => {
  const workflow = buildFusionWorkflow(config, "Design caching", "Prefer the simplest safe design");
  const { result, events } = await executeWorkflow(workflow, {
    architect: "architect analysis",
    analyst: "analyst analysis",
    synthesis: "synthesized answer",
  });

  assert.deepEqual(events.map((event) => event.kind), ["all", "run"]);
  const analyses = events[0] as AllEvent;
  const synthesis = events[1] as RunEvent;
  assert.deepEqual(analyses.items.map((item) => item.agent), [AGENTS.architect, AGENTS.analyst]);
  assert.equal(synthesis.key, "synthesis");
  assert.equal(synthesis.params.agent, AGENTS.architect);
  assert.equal(synthesis.params.model, "models/architect:high");
  assert.match(synthesis.params.task, /architect analysis/);
  assert.match(synthesis.params.task, /analyst analysis/);
  assert.equal(result, "synthesized answer");
});

test("fusion-build executes architect plan, one builder, then analyst review", async () => {
  const workflow = buildFusionBuildWorkflow(config, "Implement caching");
  const { result, events } = await executeWorkflow(workflow, {
    plan: "the plan",
    build: "the build handoff",
    review: "the review",
  });

  assert.deepEqual(events.map((event) => event.kind), ["run", "run", "run"]);
  const steps = events as RunEvent[];
  assert.deepEqual(steps.map((step) => step.key), ["plan", "build", "review"]);
  assert.deepEqual(steps.map((step) => step.params.agent), [AGENTS.architect, AGENTS.builder, AGENTS.analyst]);
  assert.deepEqual(steps.map((step) => step.params.model), [
    "models/architect:high",
    "models/builder:medium",
    "models/analyst:xhigh",
  ]);
  assert.equal(steps.filter((step) => step.params.agent === AGENTS.builder).length, 1);
  assert.equal(steps[1].params.acceptance, "checked");
  assert.deepEqual(steps[1].params.agentContract, { version: 1 });
  assert.match(steps[1].params.task, /the plan/);
  assert.match(steps[2].params.task, /the plan/);
  assert.match(steps[2].params.task, /the build handoff/);
  assert.equal(result, "the review");
});

test("workflow generation safely preserves JavaScript-like user input", async () => {
  const input = "quotes \"' and `backticks` with ${globalThis.injected = true}\n); throw new Error('injected'); //";
  const instruction = "merge `${globalThis.instructionInjected = true}`; return 'wrong'";
  const workflow = buildFusionWorkflow(config, input, instruction);
  const { result, events } = await executeWorkflow(workflow, {
    architect: "architect output",
    analyst: "analyst output",
    synthesis: "safe output",
  });

  assert.equal(events.length, 2);
  const analyses = events[0] as AllEvent;
  const synthesis = events[1] as RunEvent;
  assert.ok(analyses.items.every((item) => item.task.includes(input)));
  assert.ok(synthesis.params.task.includes(input));
  assert.ok(synthesis.params.task.includes(instruction));
  assert.equal(result, "safe output");
  assert.equal((globalThis as Record<string, unknown>).injected, undefined);
  assert.equal((globalThis as Record<string, unknown>).instructionInjected, undefined);
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
