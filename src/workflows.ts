import type { FusionConfig } from "./config.ts";

export type WorkflowConfig = FusionConfig;

export const AGENTS = Object.freeze({
  analyst: "pi-fusion.analyst",
  architect: "pi-fusion.architect",
  builder: "pi-fusion.builder",
});

interface ParallelTask {
  agent: string;
  task: string;
  model: string;
  label?: string;
  as?: string;
  output: false;
}

interface ChainStep {
  agent?: string;
  task?: string;
  model?: string;
  label?: string;
  as?: string;
  output?: false;
  acceptance?: "checked";
  agentContract?: { version: 1 };
  parallel?: ParallelTask[];
  concurrency?: number;
}

export interface OpinionWorkflow {
  tasks: ParallelTask[];
  concurrency: number;
  context: "fresh";
  async: true;
  artifacts: true;
}

export interface ChainWorkflow {
  chain: ChainStep[];
  context: "fresh";
  async: true;
  artifacts: true;
  agentContract: { version: 1 };
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

function analysisTask(role: "ARCHITECT" | "BUILDER", task: string): string {
  return [
    `You are the ${role} perspective in a two-model fusion workflow.`,
    "Analyze independently. Inspect the project when relevant, but do not modify files.",
    "Return a decisive, evidence-grounded answer for a later synthesis step.",
    "",
    "REQUEST",
    task,
  ].join("\n");
}

export function buildOpinionWorkflow(config: WorkflowConfig, task: string): OpinionWorkflow {
  return {
    tasks: [
      {
        agent: AGENTS.analyst,
        label: "Architect opinion",
        task: analysisTask("ARCHITECT", task),
        model: config.architectModel,
        output: false,
      },
      {
        agent: AGENTS.analyst,
        label: "Builder opinion",
        task: analysisTask("BUILDER", task),
        model: config.builderModel,
        output: false,
      },
    ],
    concurrency: 2,
    context: "fresh",
    async: true,
    artifacts: true,
  };
}

export function buildFusionWorkflow(
  config: WorkflowConfig,
  task: string,
  instruction = DEFAULT_FUSION_INSTRUCTION,
): ChainWorkflow {
  return {
    chain: [
      {
        parallel: [
          {
            agent: AGENTS.analyst,
            label: "Architect analysis",
            as: "architect",
            task: analysisTask("ARCHITECT", task),
            model: config.architectModel,
            output: false,
          },
          {
            agent: AGENTS.analyst,
            label: "Builder analysis",
            as: "builder",
            task: analysisTask("BUILDER", task),
            model: config.builderModel,
            output: false,
          },
        ],
        concurrency: 2,
      },
      {
        agent: AGENTS.architect,
        label: "Fuse analyses",
        model: config.architectModel,
        output: false,
        task: [
          "Synthesize the independent analyses below into one definitive answer.",
          `Fusion instruction: ${instruction}`,
          "Discard unsupported claims instead of averaging them. Preserve useful divergence with attribution.",
          "End with a concise 'Consensus and Divergence' section.",
          "",
          `Original request: ${task}`,
          "",
          "ARCHITECT ANALYSIS",
          "{outputs.architect}",
          "",
          "BUILDER ANALYSIS",
          "{outputs.builder}",
        ].join("\n"),
      },
    ],
    context: "fresh",
    async: true,
    artifacts: true,
    agentContract: { version: 1 },
  };
}

export function buildFusionBuildWorkflow(config: WorkflowConfig, task: string): ChainWorkflow {
  return {
    chain: [
      {
        agent: AGENTS.architect,
        label: "Architect plan",
        as: "plan",
        model: config.architectModel,
        output: false,
        task: [
          "Produce a grounded implementation plan for the request below.",
          "Inspect relevant files, identify acceptance checks, and remain read-only.",
          "Prefer the smallest correct implementation and call out unresolved user decisions.",
          "",
          "REQUEST",
          task,
        ].join("\n"),
      },
      {
        agent: AGENTS.builder,
        label: "Builder implementation",
        as: "build",
        model: config.builderModel,
        output: false,
        acceptance: "checked",
        agentContract: { version: 1 },
        task: [
          "Implement the request using the architect plan as guidance.",
          "You are the only mutation-capable agent in this workflow.",
          "Validate the result with the project's existing tests, type checks, builds, or focused checks.",
          "Return changed files, commands with exit codes, residual risks, and anything left undone.",
          "",
          `REQUEST: ${task}`,
          "",
          "ARCHITECT PLAN",
          "{outputs.plan}",
        ].join("\n"),
      },
      {
        agent: AGENTS.architect,
        label: "Architect review",
        model: config.architectModel,
        output: false,
        task: [
          "Review the completed implementation against the request and architect plan.",
          "Inspect the actual files. Do not modify anything.",
          "Report blockers first, then fixes worth doing now, then optional improvements.",
          "If no fixes are needed, state that plainly and summarize the validation evidence.",
          "",
          `REQUEST: ${task}`,
          "",
          "ARCHITECT PLAN",
          "{outputs.plan}",
          "",
          "BUILDER HANDOFF",
          "{outputs.build}",
        ].join("\n"),
      },
    ],
    context: "fresh",
    async: true,
    artifacts: true,
    agentContract: { version: 1 },
  };
}
