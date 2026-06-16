# Coordination benchmark — internal findings

## TL;DR — no coordination self-heals; worktrees pay a merge tax; decompose and there is nothing to merge

The question: when several coding agents work one repo at once, does *coordinating* them reduce the
time to a correct result versus the alternatives (nothing, a shared markdown lock, git worktrees)?
We measured it with real concurrent headless agents, same model every arm, same grader.

The honest answer is that **coordination does not win on raw speed**, and the real lever is
**architectural**. Two distinct comparisons:

### Shared file (apples-to-apples: every agent edits the same dispatch.py)
6 agents, 3 clean trials each, median wall-clock time to a correct integrated result:

| Approach | Median time | of which integration | Merge conflicts | Correct |
|---|---|---|---|---|
| No coordination | 80.8s | 0s | n/a | 100% |
| Git worktrees | 187.4s | 145.2s (77%) | 5 | 100% |

No-coordination is fastest and stays correct: capable agents re-read a file right before editing,
so even 6 of them writing one `dispatch.py` converge with zero lost work. Worktrees are also correct
but slower, and **77% of the worktrees time is the integration tax** (running the merges
plus a language model resolving each conflict), not agent work.

### Decomposed architecture (no shared file: each agent writes its own fragment)
| Approach | Median time | Correct | Tokens vs no-coord |
|---|---|---|---|
| **Decompose + deterministic assembly** | **19.4s** | **100%** | **~3.8x fewer** |

Each agent writes its OWN `mathkit/ops/<name>.py` in parallel (zero contention by design) and a
deterministic step (no LLM) assembles the dispatcher. This is the CRDT / commutative-operations /
drop-in / conf.d / plugin-discovery idea.

### Three honest caveats (read before quoting numbers)
1. **The decomposed number is a DIFFERENT, easier task.** It does not edit the shared file, so it is
   not "a faster merge" — it is "no contention because the architecture removed it." The agents did
   measurably less work (~3.8x fewer tokens). The apples-to-apples comparison is the
   shared-file table (none vs worktrees); the decomposed row is a different architecture, reported as
   such, not a like-for-like race.
2. **`merge_conflicts` is a git-merge-only counter, and within worktrees it is N-1 by construction.**
   A real `git merge` runs ONLY in the worktrees arm, so other arms report null (n/a), not zero. And
   for fully-overlapping additive edits the first branch fast-forwards and every later branch
   conflicts, so the count is a deterministic function of agent count and merge order (3→2, 6→5,
   10→9), NOT a measure of conflict severity. The load-bearing merge-tax signal is integration time
   and resolver token/$ cost, which DO scale with real contention.
3. **The exclusive-lock arm was dropped.** A lock serializes by construction (N agents take turns on
   one file ≈ N× the cost of one), so it is structurally the slowest and adds nothing to measure. We
   state it as a principle, not a chart.

### Data integrity
Concurrent headless agents on a single Claude Max account are themselves rate-limited. A trial where
any agent's CLI run returns an error mid-task (`is_error`) is **infra contamination, not a
coordination outcome**, so `run.js` discards and retries such trials (`--max-attempts`,
`--retry-cooldown`) until every recorded trial has zero agent failures. A `none`-arm trial that fails
the test because agents legitimately clobbered each other is a *valid* result and is kept. Every
number above is from trials where all agents completed cleanly.

---

**Method:** N agents work the same task on one repo under each regime. Same model
(claude-sonnet-4-6) for every arm; only the coordination mechanism differs. Each trial is graded by
the task's own test suite (correct = every contribution present and working). Headline metric =
wall-clock time to a correct, integrated result.

## Supplementary findings (from earlier clean runs; absolute times vary with machine load)

### Additive control (3 agents: separate files + a shared registry)
Low-contention control. No coordination and worktrees both finish correct; worktrees already shows
2 merge conflicts at just 3 agents. Coordination (lock) was slowest here too.

### Scaling: merge conflicts grow ~N-1 (worktrees), agents self-heal without coordination
| Agents | No coordination | Git worktrees (conflicts) |
|---|---|---|
| 3 | correct, 0 lost | 100% correct, **2** |
| 6 | correct, 0 lost | 100% correct, **5** |
| 10 | correct, 0 lost | 100% correct, **9** |

Worktree conflicts are N-1 by construction (see caveat 2). No-coordination never lost work, even with
10 agents on one file. The merge tax (integration time + resolver cost) is what actually grows with
the fleet.

### Cross-vendor check (does the self-heal depend on Claude?)
3 **gemini** agents, no coordination, same shared file: all 3 contributions survived (gemini also
re-reads before writing). So "uncoordinated agents self-heal on additive work" is not Claude-specific.

### Specification-gap task (1 producer picks an unspecified interface; 3 consumers must match)
The scenario where correctness depends on a decision only one agent holds. Even here coordination did
not win: capable agents converge on conventional interface names, so even isolated worktree consumers
integrated without communicating. Forcing a claim-to-read protocol added friction and a failure mode
(the only arm that failed a trial).

## Verdict

**"Coordination reduces time" is NOT supported.** No-coordination was fastest on the shared-file task
and never lost work on additive tasks; an exclusive lock serializes and is slowest. The genuine cost
that coordination avoids is the worktree **merge tax** (integration time + LLM conflict resolution),
which grows with the fleet. The biggest lever is not a better merge or a lock at all: it is
**decomposing contributions so there is nothing to share** — and then a coordination layer's job is
to make that design safe and auditable.

## Position

Position Regente on **safety / governance / auditability + enabling the decomposed pattern**, not raw
throughput: no worktree merge tax, enforced claims, a signed audit log, and (next) a **merge claim**
that grants commutative/additive regions immediately, records the operation instead of holding a
lock, and assembles deterministically. The data does not support a bare speed claim, and a speed
claim would be refuted by this very benchmark. Raw data: `results-contended-dispatch.json` (and
`results-contended-dispatch.4arm-raw.json` preserves the earlier run that still included the
exclusive-lock arm, for provenance).
