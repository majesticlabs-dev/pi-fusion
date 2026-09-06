# pi-fusion

Pi-native architect, analyst, and builder workflows built on [`pi-subagents`](https://github.com/nicobailon/pi-subagents).

It adapts the workflow ideas from [`disler/fusion-harness`](https://github.com/disler/fusion-harness).

## Requirements

- Pi
- `pi-subagents` 0.43.0 or later
- Authenticated architect, analyst, and builder models

## Install

```bash
pi install https://github.com/majesticlabs-dev/pi-fusion
```

For local development, run `pi install .` from this repository. Restart Pi or run `/reload` after installation.

## Configure models

Create or edit the user configuration at:

```text
~/.pi/agent/pi-fusion.json
```

```json
{
  "architect": {
    "model": "claude-bridge/claude-opus-5",
    "effort": "high"
  },
  "analyst": {
    "model": "openai-codex/gpt-5.6-sol",
    "effort": "xhigh"
  },
  "builder": {
    "model": "openai-codex/gpt-5.6-sol",
    "effort": "high"
  }
}
```

Each agent requires a fully qualified `provider/model` identifier and an explicit effort: `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, or `max`. Run `pi --list-models` to see available identifiers. Pi-fusion reads this file when each command starts, so configuration changes do not require `/reload`.

A trusted project can override the user configuration by creating:

```text
<project>/.pi/pi-fusion.json
```

All three agent objects and both fields in each object are required in an override. Pi-fusion searches from the current working directory upward and uses the nearest override. Precedence is nearest trusted project override, user configuration, then package defaults; files are not merged.

Run `/fusion-config` to verify the resolved model-effort pairs and configuration paths.

## Commands

| Command | Purpose | Modifies files |
| --- | --- | --- |
| `/fusion-config` | Show the resolved model-effort pairs and configuration paths | No |
| `/opinion <request>` | Get two independent model opinions | No |
| `/fusion <request> [:: merge instruction]` | Get two analyses and one architect synthesis | No |
| `/fusion-build <request>` | Plan, implement, and review a change | Yes |

### Check configuration

```text
/fusion-config
```

Use this first to confirm which architect, analyst, and builder model-effort pairs will run.

### Get independent opinions

```text
/opinion Review the authentication design
```

This runs the read-only architect and analyst independently and concurrently. It returns separate results without synthesizing them.

### Analyze and synthesize

```text
/fusion Design the caching strategy
```

This runs architect and analyst read-only analyses in parallel, then uses the architect to synthesize consensus, disagreements, and a recommendation.

Add an optional synthesis instruction after `::`:

```text
/fusion Design the caching strategy :: Prefer operational simplicity
```

### Implement a change

```text
/fusion-build Add request-level caching with tests
```

This runs a sequential workflow:

1. Architect plans with read-only tools.
2. Builder implements as the only mutation-capable agent.
3. Analyst reviews the actual result with read-only tools.

The review does not silently trigger another writer. The parent or user decides whether identified fixes should run.

## Safety boundary

- `pi-fusion.architect` and `pi-fusion.analyst` have only `read`, `grep`, `find`, and `ls`.
- `pi-fusion.builder` is the only role with `bash`, `edit`, and `write`.
- `/opinion` and `/fusion` never launch a writer.
- `/fusion-build` has one writer, sequentially surrounded by read-only architect planning and analyst review.
- Pi-subagents owns child lifecycle, FleetView, artifacts, cancellation, costs, model resolution, and session attribution.

The original harness's model-generated executable gate is intentionally not included. Validation uses project-owned tests and checks run by the single builder, followed by independent analyst review.

## Attribution

This project is inspired by [`disler/fusion-harness`](https://github.com/disler/fusion-harness). That project established the two-model ARCHITECT and BUILDER framing, independent opinion and fusion workflows, and explicit consensus and divergence reporting for Pi.

Pi-fusion is an independent Pi-native implementation built on `pi-subagents`. It replaces the original subprocess orchestration and shared-writer behavior with native lifecycle management and an enforced single-writer workflow.

## Development

```bash
npm install
npm test
npm run typecheck
```
