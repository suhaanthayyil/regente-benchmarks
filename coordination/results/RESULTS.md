# Coordination benchmark — internal findings

## TL;DR — locks lose, merge wins
On the 6-agent contended task (same goal, same grader, full 3-trial run to completion):

| Approach | Median time | Merge conflicts | Correct |
|---|---|---|---|
| No-coordination | 80.8s | 0 | 100% |
| Git worktrees | 244s | 5 | 100% |
| Regente today (exclusive lock) | 474s | 0 | 100% |
| **Regente engine-merge (new)** | **19.4s** | **0** | **100%** |

**The exclusive-lock model serializes and is the slowest. The fix is to MERGE commutative edits
instead of locking them: ~12x faster than worktrees, ~24x faster than the lock, ~4x faster than
no-coordination, zero conflicts.** (An earlier 3-trial run gave 63 / 203 / 410 / 20.8s — same
pattern; absolute times vary with machine load, the ratios hold.) Mechanism: each agent writes its own fragment in parallel (no
contention, no lock); the engine assembles the result deterministically (no LLM merge). This is
the CRDT/commutative-operations idea. It wins on the additive pattern (registries, routes,
exports, DI, config) — the common multi-agent case — not on arbitrary same-line refactors.

### Two honest caveats (read these before quoting the numbers)
1. **`merge_conflicts` is a git-merge-only counter.** A real `git merge` happens ONLY in the
   worktrees arm. The shared-tree arms (none / markdown / lock / engine-merge) never run a git
   merge, so their `0` is true by construction, NOT proof they handled contention. The honest
   cross-arm signal is correctness (tests_pass) + lost work, not this counter.
2. **Engine-merge's ~10x is partly an architectural reframe, not a faster merge.** In that arm
   each agent writes its OWN new file (`mathkit/ops/<name>.py`) — zero contention by design — and
   the per-agent task is simpler ("write one file") than editing two spots in a shared file. So
   the speedup comes from AVOIDING the shared edit (the conf.d / drop-in / plugin-discovery
   pattern), not from merging the same edits faster. The apples-to-apples comparison is among the
   arms that all edit the shared file (lock slowest, worktrees pay merge debt, no-coord fastest).
   The real lesson: the fastest, safest multi-agent design is to decompose contributions so there
   is nothing to merge — and a coordination layer's job is to facilitate + audit that.

---

**Question:** does coordinating multiple agents (Regente) reduce the time to complete a task
versus the no-Regente ways of coordinating (a shared markdown file, git worktrees, or nothing)?

**Method:** N agents work the same task on one repo under each regime. Same model
(claude-sonnet-4-6) for every arm; only the coordination mechanism differs. Each trial is
graded by the task's own test suite (correct = every contribution present and working). 3
trials per arm. Headline metric = wall-clock time to a correct, integrated result.

## Results

### Controlled task (3 agents: separate files + a shared registry)
| Setup | Success | Median time | Merge conflicts |
|---|---|---|---|
| No coordination | 100% | **50.8s** | 0 |
| Shared markdown | 100% | 84.3s | 0 |
| Git worktrees | 100% | 81.9s | 2 |
| Regente | 100% | 247.8s | 0 |

### Contended task (6 agents all editing the SAME dispatch.py)
| Setup | Success | Median time | Merge conflicts |
|---|---|---|---|
| No coordination | 100% | **71s** | 0 |
| Shared markdown | 100% | 98.4s | 0 |
| Git worktrees | 100% | 214s | **5** |
| Regente (fair re-run) | 100% | 410.5s | 0 |

Regente was re-run with a corrected proactive-claim prompt (the first run thrashed: agents
edited -> got hard-blocked -> retried). Fair number: 410.5s median (was 632s). Still ~6x
no-coordination, because serializing 6 agents on ONE hot file is inherently sequential — that
is the cost of the guarantee, not a tuning bug.

### Cross-vendor check (does the result depend on Claude?)
3 **gemini** agents, no coordination, same shared file: **all 3 contributions survived** (gemini
also re-reads before writing). So the "uncoordinated agents self-heal" finding is not
Claude-specific — gemini does it too. (codex headless was inconclusive: auth/routing to the
desktop app; not pursued.)

### Scaling: 3 -> 6 -> 10 agents on ONE shared file (median time / merge conflicts)
| Agents | No coordination | Git worktrees | Regente |
|---|---|---|---|
| 3 | 51s / 0 conflicts | 82s / **2** | 248s / 0 |
| 6 | 71s / 0 conflicts | 214s / **5** | 410s / 0 |
| 10 | 124s / 0 conflicts | 316s / **9** | 731s / 0 |

Every arm stayed 100% correct at every scale. Two clean trends:
- **Worktree merge conflicts grow linearly (~N-1): 2 -> 5 -> 9.** Per-agent branches accumulate
  merge debt with every agent added. Regente holds at zero.
- **No-coordination is fastest at every scale** and never lost work, even with 10 agents on one
  file. Regente is slowest at every scale (serialization).

### Specification-gap task (1 producer picks an unspecified interface; 3 consumers must match)
The scenario a published paper ("The Specification Gap", arXiv 2603.24284) says coordination is
for: correctness depends on a decision only one agent holds.
| Setup | Success | Median time |
|---|---|---|
| No coordination | 100% | 104.5s |
| Shared markdown | 100% | 89.9s |
| Git worktrees (isolated) | 100% | 62.8s |
| Regente | **50%** | 185.1s |

Even here coordination did not win. Capable agents **converge on conventional interfaces**: even
isolated worktree consumers picked field names that matched the producer's, so they integrated
without ever communicating. And Regente was the only arm that FAILED a trial — because consumers
were told to claim-a-file-to-READ-it (queue behind the producer), and that claim-to-read flow
thrashed. Honest caveat: that is partly a misapplication (claims are for writes, not reads) — but
it is itself a finding: forcing a claim protocol where a plain shared-file read would do adds
friction and new failure modes.

## Exhaustively tested (to be sure the verdict is fair)
Additive (3 agents) · single-file contention (6 agents) · scale (10 agents) · cross-vendor (gemini) ·
fair Regente re-run · specification-gap (partial knowledge). Coordination won in NONE of them on
speed or correctness. To make it win would require engineering a task specifically so the
alternatives fail — which is rigging, and was explicitly out of bounds.

## Verdict

**"Coordination reduces time" is NOT supported — it is the opposite.** No-coordination was
fastest in both tasks; Regente was slowest (5-9x).

Why:
1. **Agents on a shared tree do not clobber each other.** Claude Code's Edit tool re-reads each
   file before writing, so even 6 agents editing one file all succeeded with zero lost work and
   no coordination. The corruption that coordination prevents did not occur.
2. **Coordination costs time.** Regente serializes access (claim -> wait -> release) plus MCP
   latency plus strict-mode block/retry churn (8-9 edit.blocked per trial). Pure overhead when
   there is no real collision to prevent.

What each approach actually won:
- **No-coordination:** fastest and correct here (additive task + self-healing agents).
- **Worktrees:** correct, but a real and growing merge tax (2 conflicts at 3 agents -> 5 at 6),
  each needing an LLM to resolve. This is the cost Regente genuinely avoids.
- **Regente:** the only guarantee of zero conflicts + zero lost work + a signed audit log, at a
  large latency cost.

## Honest caveats

- Both tasks are **additive** (each agent adds code). That is exactly where re-reading agents
  self-heal. A non-additive scenario (semantic refactor of shared code, cross-file dependency,
  untrusted/buggy agents) might break uncoordinated runs; this benchmark did not construct one
  that defeats the Edit-tool re-read, despite trying (6-way single-file contention still passed
  uncoordinated).
- Regente's latency is **partly an artifact**: strict-mode hard-block + reactive claiming makes
  agents edit -> get blocked -> claim -> retry. Warn-mode or proactive claiming would cut it.
  But coordination fundamentally serializes, so it will not beat free-running agents on time.
- Single model, small tasks, N<=6, 3 trials: directional, not definitive.

## Implication

Position Regente on **safety / governance / auditability**, not throughput: no worktree merge
tax, enforced claims, and a signed log that matter for trust and compliance at fleet scale and
for untrusted or non-additive work. The data does not support a speed claim, and a speed claim
would be refuted by this very benchmark. Raw data: `results-controlled-mathkit.json`,
`results-contended-dispatch.json`.
