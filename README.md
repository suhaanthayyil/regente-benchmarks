# Regente benchmarks

Reproducible benchmarks of multi-agent coding coordination, from the team building
[Regente](https://regente.dev) (a local-first, vendor-neutral coordination layer for
already-running coding agents).

## 2026-06-17 — the merge claim, built into the real engine

We built a `merge` claim into Regente's engine (additive regions coexist and run in parallel;
genuine same-symbol conflicts are ordered) and re-ran on the REAL engine (hook + MCP + claims),
not a script. Task `mixed`: 6 agents add commands to one shared `dispatch.py` (additive) + 2 of
them edit the SAME `_validate` function (a genuine conflict). Fair interleaved run, 3 trials
round-robin (`coordination/results/results-mixed-dispatch.json`):

| Approach | Median time | Merge-resolution tokens | Cost/run | Correct |
|---|---|---|---|---|
| No coordination | **72.3s** | 0 | **$1.70** | 100% |
| Git worktrees | 209.7s | ~1.03M | $2.30 | 100% |
| **Regente (merge claim)** | **166.5s** | **0** | $3.00 | 100% |

- The merge claim fixed the old exclusive lock (~474s, it serialized the whole file -> 166.5s).
  Regente is now **faster than git worktrees** with **zero merge-resolution tokens** (worktrees
  burned ~1M tokens having an LLM resolve conflicts), 100% correct, 0 edit-blocks, audited.
- Honest limits (the data, no spin): **no coordination self-heals** even on the conflict and is
  fastest + cheapest; and coordination has its own token cost, so Regente was the **most
  expensive** arm in total $. The merge claim removes the worktree merge tax but the coordination
  protocol costs more than that tax saved here. Regente's value is removing the worktree merge tax
  + an enforced/audited fleet on one tree, NOT out-running or undercutting free-running agents.
- Reproducibility: `none` and `worktrees` run standalone (below). The `regente` arm drives the
  real Regente engine (hook + MCP), so it requires Regente installed alongside the checkout
  (see regente.dev); the raw result JSON + write-up are included here for transparency either way.

## coordination/ — how should multiple agents share one repo?

Several coding agents work on one repository at the same time. How should they share it so the
result is correct without grinding to a halt? We measured it with real concurrent headless agents
(same model for every arm; only the sharing mechanism changes), graded by the same test suite.

There are two distinct comparisons, and conflating them is the easiest way to lie with this data.

### Shared file — apples-to-apples (every agent edits the same dispatch.py)
6 agents, 3 clean trials each, median wall-clock time to a correct integrated result:

| Approach | Median time | of which integration | Correct |
|---|---|---|---|
| No coordination (shared tree) | 80.8s | 0s | 100% |
| Git worktrees (branch per agent, merge at end) | 187.4s | 145.2s (77%) | 100% |

- **No coordination is fastest and stays correct.** Capable agents re-read a file right before
  editing it, so even 6 of them writing one `dispatch.py` converge with zero lost work. Verified with
  Claude and gemini.
- **Worktrees are correct but pay a merge tax**, and 77% of the worktrees time is the
  integration step (running the merges + a language model resolving each conflict), not agent work.
  Merge conflicts grow ~N-1 with the fleet (2 → 5 → 9 at 3 → 6 → 10 agents).

### Decomposed architecture — no shared file (each agent writes its own fragment)

| Approach | Median time | Correct | Tokens vs no-coord |
|---|---|---|---|
| Decompose + deterministic assembly | **19.4s** | 100% | ~3.8x fewer |

Each agent writes its OWN new file in parallel (zero contention by design) and a deterministic step
(no language model) assembles the result. This is the conf.d / drop-in / plugin-discovery / CRDT
idea: design contributions so there is nothing to merge.

## Three honest caveats (please read before quoting numbers)

1. **The decomposed number is a DIFFERENT, easier task.** It never edits the shared file, so it is
   not "a faster merge" — it is "no contention because the architecture removed it." The agents did
   measurably less work (~3.8x fewer tokens). The like-for-like comparison is the
   shared-file table; the decomposed row is a different architecture, reported as such.
2. **`merge_conflicts` is git-merge-only and N-1 by construction.** A real `git merge` runs only in
   the worktrees arm (others report n/a, not 0), and for overlapping additive edits the first branch
   fast-forwards while every later branch conflicts, so the count tracks merge order, not severity.
   The load-bearing merge-tax signal is integration time and resolver cost.
3. **An exclusive-lock arm was measured earlier and dropped.** A lock serializes by construction
   (N agents take turns ≈ N× the cost of one), so it is structurally the slowest and adds nothing to
   chart. The earlier 4-arm run that still includes it is preserved at
   `coordination/results/results-contended-dispatch.4arm-raw.json` for provenance.

### Data integrity
Concurrent headless agents on a single account are themselves rate-limited. A trial where any agent's
CLI run errors mid-task (`is_error`) is infra contamination, not a coordination outcome, so `run.js`
discards and retries it (`--max-attempts`, `--retry-cooldown`) until every recorded trial has zero
agent failures. A `none`-arm trial that fails because agents legitimately clobbered each other is a
valid result and is kept.

Full write-up and per-arm detail: [`coordination/results/RESULTS.md`](coordination/results/RESULTS.md).
Blog post: https://regente.dev/blog/nothing-to-merge

## Reproduce
```bash
# requires: the `claude` CLI logged into a plan; python3; git
node coordination/run.js --task contended --agents 6 \
  --arms none,worktrees,regente-merge --trials 3
```
Workspaces are temp dirs, auto-cleaned (pass `--keep` to retain one for inspection). Each trial
spins fresh agents; results land in `coordination/results/`.

MIT licensed.
