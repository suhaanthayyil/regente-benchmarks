"use strict";

const fs = require("fs");

// Task definitions for the coordination benchmark.
//
//  controlled: each agent adds a separate file + appends to a shared registry. Low contention
//              (Claude's re-reading Edit tool rarely clobbers appends) — a benign control.
//  contended:  every agent edits the SAME function + list in ONE shared file (dispatch.py).
//              High contention designed to break uncoordinated/worktree workflows at scale.
//
// The base task is identical across arms; only the coordination preamble differs, so the
// coordination mechanism is the variable under test.

const path = require("path");

const CONTROLLED = {
  id: "controlled-mathkit",
  template: path.join(__dirname, "..", "task", "controlled"),
  testCmd: ["python3", "test.py"],
  sharedFiles: ["mathkit/registry.py", "mathkit/__init__.py"],
  subtasks: [
    { name: "add", desc: "a + b (their sum)" },
    { name: "multiply", desc: "a * b (their product)" },
    { name: "subtract", desc: "a - b (the first minus the second)" },
  ],
  body(sub) {
    return [
      `Your task: add a two-argument operation "${sub.name}" that computes ${sub.desc}.`,
      `- Create mathkit/op_${sub.name}.py containing exactly: def ${sub.name}(a, b): return <the correct result>.`,
      `- Register it in the SHARED file mathkit/registry.py: add "from .op_${sub.name} import ${sub.name}" and "register(\\"${sub.name}\\", ${sub.name})".`,
      `- Export it in mathkit/__init__.py: add "from .op_${sub.name} import ${sub.name}".`,
      `- CRITICAL: do not remove or overwrite any other operation's import or registration. After your edit, mathkit/registry.py must still contain every registration that was there before, plus yours.`,
    ].join("\n");
  },
};

const CONTENDED = {
  id: "contended-dispatch",
  template: path.join(__dirname, "..", "task", "contended"),
  testCmd: ["python3", "test.py"],
  sharedFiles: ["mathkit/dispatch.py"],
  subtasks: [
    { name: "add", op: "a + b" },
    { name: "sub", op: "a - b" },
    { name: "mul", op: "a * b" },
    { name: "floordiv", op: "a // b" },
    { name: "mod", op: "a % b" },
    { name: "power", op: "a ** b" },
  ],
  body(sub) {
    return [
      `Your task: add the command "${sub.name}" to the SHARED dispatcher in mathkit/dispatch.py. It must compute ${sub.op} of the two arguments a and b.`,
      `Both edits are in the ONE file mathkit/dispatch.py, which every agent is editing at the same time:`,
      `- Add "${sub.name}" to the HANDLERS list (keep every existing entry).`,
      `- Inside route(cmd, a, b), add a branch BEFORE the final raise:  elif cmd == "${sub.name}": return ${sub.op}`,
      `- CRITICAL: do not remove or alter any other command's HANDLERS entry or route() branch. After your edit, route() must still handle every command it did before, plus "${sub.name}".`,
    ].join("\n");
  },
  // Engine-merge model: each agent writes its OWN fragment file (zero contention, fully
  // parallel) instead of editing the shared dispatch.py. No locks, no shared-file edits.
  fragmentBody(sub) {
    return [
      `Implement the command "${sub.name}" that computes ${sub.op} of two numbers a and b.`,
      `Create the file mathkit/ops/${sub.name}.py containing exactly: a function "def ${sub.name}(a, b):" that returns the result, and a module-level line: OP = ("${sub.name}", ${sub.name}).`,
      `Do NOT create or modify any other file. Other agents are each creating their own mathkit/ops/<name>.py at the same time — you never touch a shared file, so there is nothing to coordinate.`,
    ].join("\n");
  },
  // Deterministic engine merge: assemble the dispatcher from the fragments. Pure code, no
  // LLM, no agent — this is what Regente's engine would do for a commutative/additive region.
  mergeFragments(dir) {
    const opsDir = path.join(dir, "mathkit", "ops");
    fs.mkdirSync(opsDir, { recursive: true });
    fs.writeFileSync(path.join(opsDir, "__init__.py"), "");
    const loader = [
      "import importlib, pkgutil",
      "from . import ops",
      "",
      "HANDLERS = ['noop']",
      "_TABLE = {}",
      "for _m in pkgutil.iter_modules(ops.__path__):",
      "    _mod = importlib.import_module('mathkit.ops.' + _m.name)",
      "    if hasattr(_mod, 'OP'):",
      "        _n, _f = _mod.OP",
      "        _TABLE[_n] = _f",
      "        HANDLERS.append(_n)",
      "",
      "",
      "def route(cmd, a, b):",
      "    if cmd == 'noop':",
      "        return 0",
      "    if cmd in _TABLE:",
      "        return _TABLE[cmd](a, b)",
      "    raise ValueError('unknown command: ' + cmd)",
      "",
    ].join("\n");
    fs.writeFileSync(path.join(dir, "mathkit", "dispatch.py"), loader);
  },
};

const CONTENDED10 = {
  id: "contended10-dispatch",
  template: path.join(__dirname, "..", "task", "contended10"),
  testCmd: ["python3", "test.py"],
  sharedFiles: ["mathkit/dispatch.py"],
  subtasks: [
    { name: "add", op: "a + b" },
    { name: "sub", op: "a - b" },
    { name: "mul", op: "a * b" },
    { name: "floordiv", op: "a // b" },
    { name: "mod", op: "a % b" },
    { name: "power", op: "a ** b" },
    { name: "maxv", op: "max(a, b)" },
    { name: "minv", op: "min(a, b)" },
    { name: "absdiff", op: "abs(a - b)" },
    { name: "avg", op: "(a + b) // 2" },
  ],
  body(sub) {
    return CONTENDED.body(sub);
  },
};

// Specification-gap task: the producer alone decides the interface (FIELDS); consumers must
// match it. Uncoordinated/isolated consumers cannot learn the choice -> mismatch. This is the
// failure mode (partial knowledge) that file re-reading does NOT self-heal.
const SPECGAP = {
  id: "specgap-protocol",
  template: path.join(__dirname, "..", "task", "specgap"),
  testCmd: ["python3", "test.py"],
  sharedFiles: ["mathkit/protocol.py"],
  subtasks: [
    { name: "schema", role: "producer" },
    { name: "alpha", role: "consumer" },
    { name: "beta", role: "consumer" },
    { name: "gamma", role: "consumer" },
  ],
  body(sub, style) {
    if (sub.role === "producer") {
      const announce = style === "markdown" ? " After choosing them, append a line to COORDINATION.md listing the exact field names so consumers can match." : "";
      return [
        `You are the PRODUCER. Define the record protocol in mathkit/protocol.py:`,
        `- Set FIELDS to a list of EXACTLY three field-name strings of YOUR OWN choosing (pick specific domain names; this is your decision and is not written down anywhere else).`,
        `- Implement make_record(*values) to return a dict mapping FIELDS to the values in order.`,
        `Every consumer agent must use the exact field names you pick.${announce}`,
      ].join("\n");
    }
    const learn =
      style === "regente"
        ? `You CANNOT guess the field names. Use claim_path to claim mathkit/protocol.py BEFORE reading it: you will queue behind the producer and be granted once it has finished, then read the real FIELDS and release immediately.`
        : style === "markdown"
        ? `Read COORDINATION.md to learn the field names the producer announced; if not posted yet, wait and re-read until they are.`
        : `Read mathkit/protocol.py to learn the exact field names the producer chose.`;
    return [
      `You are CONSUMER "${sub.name}". The producer decides the record fields; ${learn}`,
      `Create mathkit/consumer_${sub.name}.py with a function def record_${sub.name}() that returns a dict whose keys are EXACTLY the producer's FIELDS, in the same order (any sample values).`,
      `CRITICAL: use the producer's ACTUAL field names. Inventing your own names fails the integration test.`,
    ].join("\n");
  },
};

const TASKS = { controlled: CONTROLLED, contended: CONTENDED, contended10: CONTENDED10, specgap: SPECGAP };

function preamble(style, agentName) {
  if (style === "regente") {
    return [
      `You are the agent named "${agentName}". OTHER agents are editing this repository at the SAME time.`,
      `Coordinate through Regente using a SHORT WRITE-LOCK so everyone stays fast:`,
      `1. Call join_workspace once (agent "${agentName}", tool "claude-code").`,
      `2. PREPARE FIRST, WITHOUT CLAIMING: read the file(s) and work out the EXACT edit you will make (the precise lines to add and where). Do ALL of this reading/thinking now — other agents are doing the same in parallel. Do NOT claim or edit yet.`,
      `3. ONLY when your edit is fully planned: call claim_path for the file, IMMEDIATELY apply your edit, then call release_claim right away. Claim -> write -> release in quick succession; hold the lock for the shortest possible time. If the claim is queued, wait for the grant, then apply+release fast.`,
      ``,
    ].join("\n");
  }
  if (style === "regente-symbol") {
    return [
      `You are the agent named "${agentName}". OTHER agents edit this repo at the SAME time, but each of you owns a DIFFERENT symbol (function), so you can work in PARALLEL.`,
      `1. Call join_workspace once.`,
      `2. Claim ONLY your own symbol with claim_path using the symbol argument (agent "${agentName}", path, symbol = the function you own). Different symbols do not block each other, so you will be granted immediately even while others hold other symbols in the same file.`,
      `3. Edit only your symbol, then release_claim.`,
      ``,
    ].join("\n");
  }
  if (style === "markdown") {
    return [
      `OTHER agents are editing this repository at the SAME time. There is no enforcement; coordinate yourself through COORDINATION.md.`,
      `BEFORE editing a shared file: read COORDINATION.md; if another agent has an open CLAIM on it, wait and re-read until released; then append "CLAIM <file> ${agentName}".`,
      `AFTER editing it, append "RELEASE <file> ${agentName}".`,
      ``,
    ].join("\n");
  }
  if (style === "worktree") {
    return [`You are working in your own private checkout. Implement your task normally; integration happens later.`, ``].join("\n");
  }
  return ``;
}

function buildPrompt(task, sub, style, agentName) {
  return preamble(style, agentName) + task.body(sub, style);
}

module.exports = { TASKS, CONTROLLED, CONTENDED, buildPrompt, preamble };
