# Coordination benchmark

Does coordinating multiple agents (Regente) reduce time-to-done versus the no-Regente ways of
coordinating: a shared markdown file, git worktrees, or nothing? **Internal findings:
[`results/RESULTS.md`](results/RESULTS.md).**

Short answer from the runs so far: **no** — on additive tasks, uncoordinated agents on a shared
tree succeed (Claude's Edit tool re-reads, so they don't clobber) and are fastest; Regente is
safest (zero conflicts, signed log) but slowest. Position on safety/governance, not speed.

## Layout
- `task/controlled/` — 3 agents add separate files + a shared registry (low contention).
- `task/contended/` — N agents all edit the same `dispatch.py` (high contention).
- `lib/tasks.js` — task defs + per-arm prompts; `lib/workspace.js` — per-trial git workspace.
- `run.js` — orchestrator: per arm x trial, launch agents concurrently, integrate (merge for
  worktrees), grade with the task's test, record time / conflicts / correctness / tokens.
- `smoke.js` — proves Regente claims+enforcement bite under headless `claude -p`.

## Run
```bash
# all 4 arms on the controlled task, 3 agents, 3 trials
node bench/coordination/run.js --task controlled --arms none,markdown,worktrees,regente --trials 3 --agents 3
# high-contention task, 6 agents
node bench/coordination/run.js --task contended --agents 6 --trials 3
```
Arms: `none` (shared tree, no rules), `markdown` (shared COORDINATION.md), `worktrees` (isolate
+ merge), `regente` (claim-before-edit, strict enforcement, MCP). Workspaces are temp dirs,
auto-cleaned. Requires the `claude` CLI logged into a plan.
