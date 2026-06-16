"use strict";

// De-risk smoke: do Regente claims actually coordinate two CONCURRENT headless
// `claude -p` agents editing the same shared file (registry.py)? If both operations
// survive and Regente recorded claims (and ideally a queued/blocked event), the
// enforcement works headless and the full 4-arm benchmark is viable.

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const REPO = "/Users/suhaan/Documents/Coding/comm";
const cli = require(path.join(REPO, "bench/routing/lib/claude-cli"));
const TEMPLATE = path.join(REPO, "bench/coordination/task/controlled");

function sh(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: "utf8", ...opts });
  return { code: r.status, out: (r.stdout || "") + (r.stderr || "") };
}

function agentPrompt(name, desc) {
  return [
    `You are the agent named "${name}-agent". Multiple agents are editing this repository at the SAME time.`,
    `Coordinate through Regente so you do not clobber each other:`,
    `1. Call the Regente MCP tool join_workspace with agent "${name}-agent" and tool "claude-code".`,
    `2. BEFORE you edit any file, claim it with the Regente MCP tool claim_path (agent "${name}-agent", the file path). If it is held by someone else the claim queues; wait and retry until you hold it.`,
    `3. Edit the file, then release it with release_claim.`,
    ``,
    `Your task: add a two-argument operation "${name}" that computes ${desc}.`,
    `- Create mathkit/op_${name}.py with: def ${name}(a, b): return <the result>.`,
    `- Edit the SHARED file mathkit/registry.py: add "from .op_${name} import ${name}" and "register(\\"${name}\\", ${name})". Do NOT remove any other operation already registered there.`,
    `- Claim mathkit/registry.py before editing it (this is the contended file).`,
  ].join("\n");
}

(async () => {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), "coord-smoke-"));
  fs.cpSync(TEMPLATE, ws, { recursive: true });
  sh("git", ["init", "-q"], { cwd: ws });
  sh("git", ["add", "-A"], { cwd: ws });
  sh("git", ["-c", "user.email=b@b.co", "-c", "user.name=bench", "commit", "-qm", "base"], { cwd: ws });
  console.log("workspace:", ws);

  console.log("regente init + enforce strict + install ...");
  console.log("  init:", sh("node", [path.join(REPO, "bin/regente"), "init"], { cwd: ws }).code);
  console.log("  enforce:", sh("node", [path.join(REPO, "bin/regente"), "enforce", "strict"], { cwd: ws }).out.trim());
  const inst = sh("node", [path.join(REPO, "bin/regente"), "install", "--no-wait"], { cwd: ws });
  console.log("  install exit:", inst.code);

  const mcpPath = path.join(ws, "regente-mcp.json");
  fs.writeFileSync(mcpPath, JSON.stringify({ mcpServers: { regente: { command: "node", args: [path.join(REPO, "bin/regente-mcp")], env: { REGENTE_WORKSPACE: ws } } } }));

  const common = {
    model: "claude-sonnet-4-6",
    cwd: ws,
    skipPermissions: true,
    allowedTools: ["Read", "Edit", "Write", "Bash", "Grep", "Glob", "LS", "mcp__regente__join_workspace", "mcp__regente__claim_path", "mcp__regente__release_claim"],
    mcpConfig: mcpPath,
    timeoutMs: 600000,
  };

  console.log("launching 2 concurrent agents (add, multiply) ...");
  const t0 = Date.now();
  const [a, b] = await Promise.all([
    cli.runClaude({ ...common, prompt: agentPrompt("add", "a + b") }),
    cli.runClaude({ ...common, prompt: agentPrompt("multiply", "a * b") }),
  ]);
  console.log(`agents done in ${((Date.now() - t0) / 1000).toFixed(0)}s  (add ok=${a.ok} err=${a.error || "-"}, multiply ok=${b.ok} err=${b.error || "-"})`);

  console.log("--- registry.py ---");
  console.log(fs.readFileSync(path.join(ws, "mathkit/registry.py"), "utf8"));
  const reg = sh("python3", ["-c", "import mathkit; from mathkit.registry import REGISTRY; print('REGISTERED:', sorted(REGISTRY))"], { cwd: ws });
  console.log(reg.out.trim());

  const status = sh("node", [path.join(REPO, "bin/regente"), "status", "--json"], { cwd: ws });
  try {
    const st = JSON.parse(status.out);
    const claims = (st.claims && (st.claims.active || st.claims)) || [];
    console.log("active claims:", JSON.stringify(claims));
    const events = sh("node", ["-e", `const c=require('${REPO}/server/regente-core');const ev=c.readEvents('${ws}');const k={};for(const e of ev)k[e.type]=(k[e.type]||0)+1;console.log(JSON.stringify(k));`], {});
    console.log("event counts:", events.out.trim());
  } catch (e) {
    console.log("status parse failed:", status.out.slice(0, 300));
  }

  const bothSurvived = /register\("add"/.test(fs.readFileSync(path.join(ws, "mathkit/registry.py"), "utf8")) && /register\("multiply"/.test(fs.readFileSync(path.join(ws, "mathkit/registry.py"), "utf8"));
  console.log(bothSurvived ? "SMOKE PASS: both registrations survived" : "SMOKE WARN: a registration was lost");
  console.log("workspace kept for inspection:", ws);
})().catch((e) => { console.error("SMOKE FAIL", e.stack || e.message); process.exit(1); });
