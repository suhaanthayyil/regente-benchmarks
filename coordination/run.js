"use strict";

// Coordination benchmark orchestrator.
//
//   node bench/coordination/run.js [--agents 3] [--trials 3] [--model claude-sonnet-4-6]
//                                  [--arms regente,markdown,worktrees,none]
//
// For each arm and trial: spin a fresh workspace, launch N agents concurrently on the
// controlled collision task (every agent must edit the shared registry.py + __init__.py),
// integrate (merge for worktrees), grade with the task's test suite, and record wall-clock
// time, correctness, lost work / merge conflicts, and tokens. Headline = time to a correct,
// integrated result. Agents are nondeterministic, so we run several trials per arm.

const fs = require("fs");
const path = require("path");

const REPO = path.join(__dirname, "..", "..");
const cli = require(path.join(REPO, "bench/routing/lib/claude-cli"));
const meter = require(path.join(REPO, "bench/routing/lib/meter"));
const store = require(path.join(REPO, "bench/routing/lib/store"));
const core = require(path.join(REPO, "server/regente-core"));
const ws = require("./lib/workspace");
const { TASKS, buildPrompt } = require("./lib/tasks");

const PRICES = store.readJson(path.join(REPO, "bench/routing/prices.json"), null);
const REGENTE_BIN = path.join(REPO, "bin/regente");
const REGENTE_MCP_BIN = path.join(REPO, "bin/regente-mcp");
const HERE = __dirname;

function parseArgs(argv) {
  const a = argv.slice(2);
  const get = (f, d) => { const i = a.indexOf(f); return i !== -1 && a[i + 1] != null ? a[i + 1] : d; };
  return {
    agents: Number(get("--agents", 3)),
    trials: Number(get("--trials", 3)),
    model: get("--model", "claude-sonnet-4-6"),
    arms: get("--arms", "none,markdown,worktrees,regente").split(","),
    task: get("--task", "controlled"),
    timeoutMs: Number(get("--timeout", 900000)),
    keep: args.includes("--keep"),
  };
}

function nowIso() { return new Date().toISOString(); }
function secs(ms) { return Math.round(ms / 100) / 10; }

function agentOpts(arm, ctx) {
  const opts = {
    model: ctx.model,
    cwd: ctx.cwd,
    skipPermissions: true,
    timeoutMs: ctx.timeoutMs,
    allowedTools: ["Read", "Edit", "Write", "Bash", "Grep", "Glob", "LS"],
  };
  if (arm === "regente") {
    opts.allowedTools = opts.allowedTools.concat([
      "mcp__regente__join_workspace", "mcp__regente__claim_path", "mcp__regente__release_claim",
      "mcp__regente__list_claims", "mcp__regente__check_handoffs", "mcp__regente__heartbeat",
    ]);
    opts.mcpConfig = ctx.mcpConfig;
  }
  return opts;
}

function grade(dir, task) {
  const r = ws.sh(task.testCmd[0], task.testCmd.slice(1), dir);
  let parsed = null;
  try { parsed = JSON.parse(r.out.trim().split("\n").filter(Boolean).pop()); } catch (_e) { /* ignore */ }
  return { pass: r.code === 0, ops_ok: parsed ? parsed.ops_ok : 0, expected: parsed ? parsed.expected : task.subtasks.length, detail: parsed };
}

function tokensOf(agentResults) {
  const calls = agentResults.flatMap((r) => (r && r.calls) || []);
  try { const m = meter.costOfCalls(PRICES, calls); return { tokens: m.total_tokens, usd: m.usd }; }
  catch (_e) { return { tokens: 0, usd: 0 }; }
}

// ---- one trial of one arm ----
async function runTrial(arm, task, opts, trialIdx) {
  const subtasks = task.subtasks.slice(0, opts.agents);
  const { ws: dir, base } = ws.makeWorkspace(task.template, `${arm}-${trialIdx}`);
  const extraDirs = [dir];
  let mcpConfig = null;
  const result = { arm, trial: trialIdx, agent_errors: [] };

  try {
    // arm-specific setup
    if (arm === "regente") {
      ws.sh("node", [REGENTE_BIN, "init"], dir);
      ws.sh("node", [REGENTE_BIN, "enforce", "strict"], dir);
      ws.sh("node", [REGENTE_BIN, "install", "--no-wait"], dir);
      mcpConfig = path.join(dir, "regente-mcp.json");
      fs.writeFileSync(mcpConfig, JSON.stringify({ mcpServers: { regente: { command: "node", args: [REGENTE_MCP_BIN], env: { REGENTE_WORKSPACE: dir } } } }));
    } else if (arm === "markdown") {
      fs.writeFileSync(path.join(dir, "COORDINATION.md"), "# Coordination log\n\nClaim a shared file before editing it; release when done. Format:\nCLAIM <file> <agent>\nRELEASE <file> <agent>\n\n");
    }

    // launch agents concurrently; worktrees get private checkouts
    const agentCwds = {};
    if (arm === "worktrees") {
      for (const s of subtasks) agentCwds[s.name] = ws.addWorktree(dir, base, `agent-${s.name}`);
      for (const s of subtasks) extraDirs.push(agentCwds[s.name]);
    }

    const t0 = Date.now();
    const agentResults = await Promise.all(subtasks.map((s) => {
      const cwd = arm === "worktrees" ? agentCwds[s.name] : dir;
      const prompt = arm === "regente-merge" && task.fragmentBody
        ? task.fragmentBody(s)
        : buildPrompt(task, s, arm === "none" ? "none" : arm, `${s.name}-agent`);
      return cli.runClaude({ ...agentOpts(arm, { model: opts.model, cwd, timeoutMs: opts.timeoutMs, mcpConfig }), prompt });
    }));
    const agentMs = Date.now() - t0;
    agentResults.forEach((r, i) => { if (!r.ok) result.agent_errors.push(`${subtasks[i].name}:${r.error}`); });

    // integration
    let integMs = 0;
    let mergeConflicts = 0;
    if (arm === "worktrees") {
      const ti = Date.now();
      for (const s of subtasks) ws.commitAll(agentCwds[s.name], `feat ${s.name}`);
      for (const s of subtasks) {
        const m = ws.git(["merge", "--no-edit", `agent-${s.name}`], dir);
        if (m.code !== 0) {
          mergeConflicts += 1;
          // resolve the conflict so the merge can complete (this is the integration tax)
          const resolver = await cli.runClaude({
            ...agentOpts("none", { model: opts.model, cwd: dir, timeoutMs: opts.timeoutMs }),
            prompt: "This git repo is mid-merge with conflicts. Resolve ALL conflicts so that EVERY math operation stays registered in mathkit/registry.py and exported in mathkit/__init__.py (keep all imports and register() calls from both sides). Remove conflict markers. Then run `git add -A`. Do not commit.",
          });
          if (!resolver.ok) result.agent_errors.push(`resolver:${resolver.error}`);
          agentResults.push(resolver);
          ws.git(["add", "-A"], dir);
          ws.git(["-c", "user.email=bench@regente.dev", "-c", "user.name=bench", "commit", "--no-edit"], dir);
        }
      }
      integMs = Date.now() - ti;
    }

    // engine-merge: deterministically assemble the target from per-agent fragments (the
    // work Regente's engine would do for a commutative region). Pure code, sub-millisecond.
    if (arm === "regente-merge" && task.mergeFragments) {
      const ti = Date.now();
      task.mergeFragments(dir);
      integMs = Date.now() - ti;
    }

    // grade final tree
    const g = grade(dir, task);
    const tok = tokensOf(agentResults);

    // coordination signals
    let coord = { edit_blocked: 0, conflict_detected: 0, claims: 0 };
    if (arm === "regente") {
      const ev = core.readEvents(dir);
      for (const e of ev) {
        if (e.type === "edit.blocked") coord.edit_blocked += 1;
        if (e.type === "conflict.detected") coord.conflict_detected += 1;
        if (e.type === "claim.created") coord.claims += 1;
      }
    }

    result.wall_s = secs(agentMs);
    result.integ_s = secs(integMs);
    result.total_s = secs(agentMs + integMs);
    result.tests_pass = g.pass;
    result.ops_ok = g.ops_ok;
    result.expected = g.expected;
    result.lost_ops = Math.max(0, g.expected - g.ops_ok);
    result.merge_conflicts = mergeConflicts;
    result.coord = coord;
    result.tokens = tok.tokens;
    result.usd = tok.usd;
  } finally {
    if (opts.keep) {
      console.log(`   [kept] ${dir}`);
    } else {
      for (const d of extraDirs) ws.cleanup(d);
    }
  }
  return result;
}

function summarize(arm, trials) {
  const ok = trials.filter((t) => t.tests_pass);
  const med = (xs) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
  const mean = (xs) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : null);
  return {
    arm,
    trials: trials.length,
    success_rate: Math.round((ok.length / trials.length) * 100) / 100,
    median_total_s_successful: med(ok.map((t) => t.total_s)),
    median_total_s_all: med(trials.map((t) => t.total_s)),
    mean_ops_ok: mean(trials.map((t) => t.ops_ok)),
    expected_ops: trials[0] ? trials[0].expected : null,
    mean_lost_ops: mean(trials.map((t) => t.lost_ops)),
    mean_merge_conflicts: mean(trials.map((t) => t.merge_conflicts)),
    mean_tokens: mean(trials.map((t) => t.tokens)),
    mean_usd: mean(trials.map((t) => t.usd)),
  };
}

async function main() {
  const opts = parseArgs(process.argv);
  const task = TASKS[opts.task];
  if (!task) throw new Error(`unknown task "${opts.task}" (have: ${Object.keys(TASKS).join(", ")})`);
  console.log(`[coord] task=${task.id} agents=${opts.agents} trials=${opts.trials} model=${opts.model} arms=${opts.arms.join(",")}`);

  const byArm = {};
  for (const arm of opts.arms) {
    byArm[arm] = [];
    for (let t = 1; t <= opts.trials; t++) {
      console.log(`[coord] ${arm} trial ${t}/${opts.trials} ...`);
      const r = await runTrial(arm, task, opts, t);
      byArm[arm].push(r);
      console.log(`   -> total ${r.total_s}s | tests_pass=${r.tests_pass} | ops ${r.ops_ok}/${r.expected} | lost ${r.lost_ops} | merge_conflicts ${r.merge_conflicts}${arm === "regente" ? ` | blocked ${r.coord.edit_blocked} claims ${r.coord.claims}` : ""}${r.agent_errors.length ? ` | errs ${r.agent_errors.join(";")}` : ""}`);
    }
  }

  const summaries = {};
  for (const arm of opts.arms) summaries[arm] = summarize(arm, byArm[arm]);

  const out = {
    benchmark: "regente-coordination",
    generated_at: nowIso(),
    task: task.id,
    n_agents: opts.agents,
    trials: opts.trials,
    model: opts.model,
    arms: opts.arms,
    per_trial: byArm,
    summary: summaries,
  };
  const outPath = path.join(HERE, "results", `results-${task.id}.json`);
  store.writeJson(outPath, out);

  console.log("\n" + "=".repeat(86));
  console.log("ARM".padEnd(12), "| success".padEnd(10), "| median time (ok)".padEnd(18), "| avg ops".padEnd(10), "| avg lost".padEnd(10), "| avg conflicts");
  console.log("-".repeat(86));
  for (const arm of opts.arms) {
    const s = summaries[arm];
    console.log(
      arm.padEnd(12), "|",
      `${Math.round(s.success_rate * 100)}%`.padEnd(8), "|",
      `${s.median_total_s_successful == null ? "n/a" : s.median_total_s_successful + "s"}`.padEnd(16), "|",
      `${s.mean_ops_ok}/${s.expected_ops}`.padEnd(8), "|",
      `${s.mean_lost_ops}`.padEnd(8), "|",
      `${s.mean_merge_conflicts}`,
    );
  }
  console.log("=".repeat(86));
  console.log(`\nWrote ${outPath}`);
}

main().catch((e) => { console.error("[coord] fatal:", e.stack || e.message); process.exit(1); });
