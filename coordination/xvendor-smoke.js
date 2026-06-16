"use strict";

// Cross-vendor probe: do GEMINI agents clobber a shared file when uncoordinated, where
// Claude agents self-healed? If yes, uncoordinated non-Claude fleets lose work and that is
// the legitimate basis for coordination's value. 3 gemini agents, no coordination, all
// editing the same dispatch.py, then graded.

const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const ws = require("./lib/workspace");
const { CONTENDED, buildPrompt } = require("./lib/tasks");

function runGemini(prompt, cwd, timeoutMs) {
  return new Promise((resolve) => {
    const args = ["-p", prompt, "--approval-mode", "yolo", "--skip-trust"];
    const child = spawn("gemini", args, { cwd, env: { ...process.env, GEMINI_CLI_TRUST_WORKSPACE: "true" } });
    let out = "";
    const timer = setTimeout(() => { try { child.kill("SIGKILL"); } catch (_e) {} resolve({ ok: false, error: "timeout", out }); }, timeoutMs);
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    child.on("close", (code) => { clearTimeout(timer); resolve({ ok: code === 0, code, out: out.slice(-500) }); });
    child.on("error", (e) => { clearTimeout(timer); resolve({ ok: false, error: e.message }); });
  });
}

(async () => {
  const subtasks = CONTENDED.subtasks.slice(0, 3); // add, sub, mul
  const { ws: dir } = ws.makeWorkspace(CONTENDED.template, "xvendor");
  console.log("workspace:", dir, "\nlaunching 3 GEMINI agents, NO coordination, on shared dispatch.py ...");
  const t0 = Date.now();
  const results = await Promise.all(subtasks.map((s) => {
    const prompt = buildPrompt(CONTENDED, s, "none", `${s.name}-agent`);
    return runGemini(prompt, dir, 600000);
  }));
  console.log(`agents done in ${((Date.now() - t0) / 1000).toFixed(0)}s — ` + results.map((r, i) => `${subtasks[i].name}:${r.ok ? "ok" : r.error || r.code}`).join(", "));
  console.log("--- dispatch.py ---");
  console.log(fs.readFileSync(path.join(dir, "mathkit/dispatch.py"), "utf8"));
  const g = ws.sh("python3", ["test.py"], dir);
  console.log("--- grade ---\n" + g.out.trim());
  console.log(g.code === 0 ? "RESULT: all 3 ops survived (gemini also self-heals)" : "RESULT: ops LOST/broken (uncoordinated gemini clobbered) — coordination would help here");
  console.log("workspace kept:", dir);
})().catch((e) => { console.error("XVENDOR FAIL", e.stack || e.message); process.exit(1); });
