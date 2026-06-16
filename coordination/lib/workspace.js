"use strict";

// Workspace setup for one trial: copy the task template into a fresh temp dir and make it a
// git repo (needed for the worktree arm and for clean per-trial isolation).

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

function git(args, cwd, input) {
  const r = spawnSync("git", args, { cwd, input, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  return { code: r.status, out: (r.stdout || ""), err: (r.stderr || "") };
}

function sh(cmd, args, cwd) {
  const r = spawnSync(cmd, args, { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  return { code: r.status, out: (r.stdout || "") + (r.stderr || "") };
}

// Fresh workspace from a template, committed as the base so worktrees/merges have a root.
function makeWorkspace(template, label) {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), `coord-${label}-`));
  fs.cpSync(template, ws, { recursive: true });
  git(["init", "-q", "-b", "main"], ws);
  git(["add", "-A"], ws);
  git(["-c", "user.email=bench@regente.dev", "-c", "user.name=bench", "commit", "-qm", "base"], ws);
  const base = git(["rev-parse", "HEAD"], ws).out.trim();
  return { ws, base };
}

// Add a worktree on a new branch off base. Returns the worktree dir.
function addWorktree(ws, base, branch) {
  const dir = path.join(ws, "..", path.basename(ws) + "__" + branch);
  git(["worktree", "add", "-q", "-b", branch, dir, base], ws);
  return dir;
}

function commitAll(dir, msg) {
  git(["add", "-A"], dir);
  git(["-c", "user.email=bench@regente.dev", "-c", "user.name=bench", "commit", "-qm", msg], dir);
  return git(["rev-parse", "HEAD"], dir).out.trim();
}

function cleanup(p) {
  try {
    fs.rmSync(p, { recursive: true, force: true });
  } catch (_e) {
    /* best effort */
  }
}

module.exports = { git, sh, makeWorkspace, addWorktree, commitAll, cleanup };
