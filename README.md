# Regente benchmarks

Reproducible benchmarks of multi-agent coding coordination, from the team building
[Regente](https://regente.dev) (a local-first, vendor-neutral coordination layer for
already-running coding agents).

## coordination/ — does coordinating multiple agents beat the alternatives?

Several coding agents work on one repository at the same time. How should they coordinate so the
result is correct without grinding to a halt? We measured four (then five) approaches on the same
task, graded by the same test suite, with real concurrent headless agents (same model for every
arm; only the coordination mechanism changes).

**Headline (6 agents, one shared file, 3 trials each, median time to a correct result):**

| Approach | Median time | Correct |
|---|---|---|
| No coordination (shared tree) | ~63s | 100% |
| Git worktrees (branch per agent, merge at end) | ~203s | 100% |
| Exclusive lock (claim-before-edit, serialize) | ~410s | 100% |
| Engine-merge (independent fragments + deterministic assembly) | ~21s | 100% |

**What it says:**
- **Exclusive locks are slowest** — a lock serializes, so N agents pay ~N times the cost of one.
- **Git worktrees pay a merge tax that grows with the fleet** — merge conflicts rose 2 → 5 → 9 as
  agents went 3 → 6 → 10, each needing resolution.
- **Capable agents on a shared tree mostly do not clobber each other** (their edit tools re-read
  before writing), so no-coordination is fast and correct on additive tasks. Verified with Claude
  and gemini.
- **The fastest, safest design is to not merge at all**: decompose contributions into independent
  drop-in fragments (the conf.d / plugin-discovery / CRDT idea) so agents never touch the same file.

## Two honest caveats (please read before quoting numbers)

1. The `merge_conflicts` counter only counts **git merges**, which happen **only in the worktrees
   arm**. The shared-tree arms (none / markdown / lock / engine-merge) never run a git merge, so
   their `0` is true by construction, not proof they handled contention. Trust correctness
   (`tests_pass`), not that counter.
2. The engine-merge speedup is **partly an architectural reframe, not a faster merge**: each agent
   writes its own new file (zero contention by design) and the per-agent task is simpler than
   editing a shared file. The strict apples-to-apples comparison is among the arms that all edit
   the shared file (lock slowest, worktrees pay the merge tax, no-coordination fastest). The
   lesson is the architecture: design contributions so there is nothing to merge.

Full write-up and per-arm detail: [`coordination/results/RESULTS.md`](coordination/results/RESULTS.md).
Blog post: https://regente.dev/blog/merge-not-lock

## Reproduce
```bash
# requires: the `claude` CLI logged into a plan; python3; git
node coordination/run.js --task contended --agents 6 \
  --arms none,worktrees,regente,regente-merge --trials 3
```
Workspaces are temp dirs, auto-cleaned (pass `--keep` to retain one for inspection). Each trial
spins fresh agents; results land in `coordination/results/`.

MIT licensed.
