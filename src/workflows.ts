import type { FusionAgentConfig, FusionConfig } from "./config.ts";

export type WorkflowConfig = FusionConfig;

export const AGENTS = Object.freeze({
  analyst: "pi-fusion.analyst",
  architect: "pi-fusion.architect",
  builder: "pi-fusion.builder",
});

export interface WorkflowRequest {
  workflowScript: string;
  context: "fresh";
  async: true;
  artifacts: true;
  agentContract?: { version: 1 };
}

const DEFAULT_FUSION_INSTRUCTION = "Critically merge both analyses into one definitive answer.";

export function parseFusionInput(input: string): { task: string; instruction: string } {
  const separator = input.indexOf(" :: ");
  const task = (separator === -1 ? input : input.slice(0, separator)).trim();
  const instruction = (separator === -1 ? DEFAULT_FUSION_INSTRUCTION : input.slice(separator + 4)).trim();

  if (!task) throw new Error("A fusion task is required.");
  if (!instruction) throw new Error("The fusion instruction after '::' cannot be empty.");
  return { task, instruction };
}

function analysisTask(role: "ARCHITECT" | "ANALYST", task: string): string {
  return [
    `You are the ${role} in a two-agent fusion workflow.`,
    "Analyze independently. Inspect the project when relevant, but do not modify files.",
    "Return a decisive, evidence-grounded answer for a later synthesis step.",
    "",
    "REQUEST",
    task,
  ].join("\n");
}

function modelSelector(config: FusionAgentConfig): string {
  return `${config.model}:${config.effort}`;
}

function workflowRequest(workflowScript: string, agentContract = false): WorkflowRequest {
  return {
    workflowScript,
    context: "fresh",
    async: true,
    artifacts: true,
    ...(agentContract ? { agentContract: { version: 1 as const } } : {}),
  };
}

export function buildOpinionWorkflow(config: WorkflowConfig, task: string): WorkflowRequest {
  const children = [
    {
      key: "architect",
      agent: AGENTS.architect,
      label: "Architect opinion",
      task: analysisTask("ARCHITECT", task),
      model: modelSelector(config.architect),
      output: false,
    },
    {
      key: "analyst",
      agent: AGENTS.analyst,
      label: "Analyst opinion",
      task: analysisTask("ANALYST", task),
      model: modelSelector(config.analyst),
      output: false,
    },
  ];

  return workflowRequest([
    `const results = await runs.all(${JSON.stringify(children)});`,
    "return results.map((result) => result.output);",
  ].join("\n"));
}

export function buildFusionWorkflow(
  config: WorkflowConfig,
  task: string,
  instruction = DEFAULT_FUSION_INSTRUCTION,
): WorkflowRequest {
  const analyses = [
    {
      key: "architect",
      agent: AGENTS.architect,
      label: "Architect analysis",
      task: analysisTask("ARCHITECT", task),
      model: modelSelector(config.architect),
      output: false,
    },
    {
      key: "analyst",
      agent: AGENTS.analyst,
      label: "Analyst analysis",
      task: analysisTask("ANALYST", task),
      model: modelSelector(config.analyst),
      output: false,
    },
  ];
  const synthesisPrefix = [
    "Synthesize the independent analyses below into one definitive answer.",
    `Fusion instruction: ${instruction}`,
    "Discard unsupported claims instead of averaging them. Preserve useful divergence with attribution.",
    "End with a concise 'Consensus and Divergence' section.",
    "",
    `Original request: ${task}`,
    "",
    "ARCHITECT ANALYSIS",
    "",
  ].join("\n");
  const analystSeparator = "\n\nANALYST ANALYSIS\n";

  return workflowRequest([
    `const analyses = await runs.all(${JSON.stringify(analyses)});`,
    "const synthesis = await runs.run(\"synthesis\", {",
    `  agent: ${JSON.stringify(AGENTS.architect)},`,
    `  label: ${JSON.stringify("Fuse analyses")},`,
    `  model: ${JSON.stringify(modelSelector(config.architect))},`,
    "  output: false,",
    `  task: ${JSON.stringify(synthesisPrefix)} + analyses[0].output + ${JSON.stringify(analystSeparator)} + analyses[1].output`,
    "});",
    "return synthesis.output;",
  ].join("\n"), true);
}

export function buildFusionBuildWorkflow(config: WorkflowConfig, task: string): WorkflowRequest {
  const planTask = [
    "Produce a grounded implementation plan for the request below.",
    "Inspect relevant files, identify acceptance checks, and remain read-only.",
    "Prefer the smallest correct implementation and call out unresolved user decisions.",
    "",
    "REQUEST",
    task,
  ].join("\n");
  const buildTaskPrefix = [
    "Implement the request using the architect plan as guidance.",
    "You are the only mutation-capable agent in this workflow.",
    "Validate the result with the project's existing tests, type checks, builds, or focused checks.",
    "Return changed files, commands with exit codes, residual risks, and anything left undone.",
    "",
    `REQUEST: ${task}`,
    "",
    "ARCHITECT PLAN",
    "",
  ].join("\n");
  const reviewTaskPrefix = [
    "Review the completed implementation against the request and architect plan.",
    "Inspect the actual files. Do not modify anything.",
    "Report blockers first, then fixes worth doing now, then optional improvements.",
    "If no fixes are needed, state that plainly and summarize the validation evidence.",
    "",
    `REQUEST: ${task}`,
    "",
    "ARCHITECT PLAN",
    "",
  ].join("\n");
  const buildSeparator = "\n\nBUILDER HANDOFF\n";

  return workflowRequest([
    "const plan = await runs.run(\"plan\", {",
    `  agent: ${JSON.stringify(AGENTS.architect)},`,
    `  label: ${JSON.stringify("Architect plan")},`,
    `  model: ${JSON.stringify(modelSelector(config.architect))},`,
    "  output: false,",
    `  task: ${JSON.stringify(planTask)}`,
    "});",
    "const build = await runs.run(\"build\", {",
    `  agent: ${JSON.stringify(AGENTS.builder)},`,
    `  label: ${JSON.stringify("Builder implementation")},`,
    `  model: ${JSON.stringify(modelSelector(config.builder))},`,
    "  output: false,",
    `  acceptance: ${JSON.stringify("checked")},`,
    "  agentContract: { version: 1 },",
    `  task: ${JSON.stringify(buildTaskPrefix)} + plan.output`,
    "});",
    "const review = await runs.run(\"review\", {",
    `  agent: ${JSON.stringify(AGENTS.analyst)},`,
    `  label: ${JSON.stringify("Analyst review")},`,
    `  model: ${JSON.stringify(modelSelector(config.analyst))},`,
    "  output: false,",
    `  task: ${JSON.stringify(reviewTaskPrefix)} + plan.output + ${JSON.stringify(buildSeparator)} + build.output`,
    "});",
    "return review.output;",
  ].join("\n"), true);
}
