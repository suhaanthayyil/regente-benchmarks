"use strict";

// The ONLY place the benchmark invokes a model. Drives the Claude Code CLI headless
// (`claude -p --output-format json`), authenticated by the user's Claude Max plan — no
// API key anywhere. This is both the solver's engine and the meter's source: the CLI's
// JSON result carries real per-model token usage (modelUsage[...]) plus the provider's
// own costUSD, which the meter cross-checks against its prices.json computation.
//
// Verified CLI JSON shape (claude 2.1.x):
//   { type:"result", subtype:"success", is_error:false, result:"<text>", num_turns:N,
//     total_cost_usd:Number,
//     usage:{ input_tokens, output_tokens, cache_read_input_tokens, cache_creation_input_tokens, ... },
//     modelUsage:{ "<model-id>": { inputTokens, outputTokens, cacheReadInputTokens,
//                                   cacheCreationInputTokens, costUSD, ... } } }
//
// The injectable-client convention mirrors server/regente-planner.js: scaffold.js and
// router.js take an injected `cli` so tests run fully offline with a mock (no spend).

const { spawn } = require("child_process");

// Pure: turn a CLI result JSON object into {ok, text, calls[]}. Exported so it can be
// unit-tested without spawning. `calls` has one entry PER MODEL the run actually used
// (usually one, since we pin --model; but Claude Code may make a background call with a
// small model — we meter every model at its own price, so background usage is counted).
function parseResult(obj) {
  if (!obj || typeof obj !== "object") {
    return { ok: false, text: "", calls: [], cost_usd_cli_total: 0, error: "no-result-object", raw: obj };
  }
  const text = typeof obj.result === "string" ? obj.result : "";
  const ok = obj.is_error !== true && obj.subtype === "success";
  const modelUsage = obj.modelUsage && typeof obj.modelUsage === "object" ? obj.modelUsage : {};
  const calls = Object.entries(modelUsage).map(([model, u]) => ({
    model,
    input_tokens: num(u.inputTokens),
    output_tokens: num(u.outputTokens),
    cache_read_tokens: num(u.cacheReadInputTokens),
    cache_write_tokens: num(u.cacheCreationInputTokens),
    cost_usd_cli: num(u.costUSD),
  }));
  return {
    ok,
    text,
    calls,
    num_turns: num(obj.num_turns),
    cost_usd_cli_total: num(obj.total_cost_usd),
    subtype: obj.subtype || null,
    error: ok ? null : obj.subtype || "cli-error",
    raw: obj,
  };
}

function num(v) {
  return typeof v === "number" && isFinite(v) ? v : 0;
}

// Build the argv for a headless claude run. Kept pure + exported so a test can assert
// exactly what flags would be passed (no surprises in how the model is driven).
function buildArgs(opts) {
  const args = ["-p", String(opts.prompt == null ? "" : opts.prompt), "--model", opts.model, "--output-format", "json"];
  if (opts.skipPermissions) args.push("--dangerously-skip-permissions");
  if (Array.isArray(opts.allowedTools) && opts.allowedTools.length) {
    args.push("--allowedTools", ...opts.allowedTools);
  }
  if (opts.appendSystemPrompt) args.push("--append-system-prompt", String(opts.appendSystemPrompt));
  if (opts.permissionMode) args.push("--permission-mode", String(opts.permissionMode));
  if (opts.mcpConfig) args.push("--mcp-config", String(opts.mcpConfig));
  if (opts.strictMcp) args.push("--strict-mcp-config");
  if (Array.isArray(opts.addDir)) for (const d of opts.addDir) args.push("--add-dir", String(d));
  return args;
}

// Spawn a headless claude run. Returns parseResult output augmented with {ok,error,
// timedOut,exitCode}. Never throws on a model failure — returns ok:false so the caller
// (router) can treat a failed rung as "escalate" and keep the benchmark moving.
function runClaude(opts) {
  return new Promise((resolve) => {
    if (!opts.model) {
      resolve({ ok: false, text: "", calls: [], cost_usd_cli_total: 0, error: "no-model", timedOut: false });
      return;
    }
    const args = buildArgs(opts);
    const timeoutMs = opts.timeoutMs || 1500000;
    let stdout = "";
    let stderr = "";
    let timedOut = false;

    const child = spawn(opts.bin || "claude", args, {
      cwd: opts.cwd || process.cwd(),
      env: { ...process.env, ...(opts.env || {}) },
      detached: true, // own process group so the timeout can kill claude's children too
    });

    const timer = setTimeout(() => {
      timedOut = true;
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch (_e) {
        try {
          child.kill("SIGKILL");
        } catch (_e2) {
          /* already gone */
        }
      }
    }, timeoutMs);

    child.stdout.on("data", (d) => {
      stdout += d.toString();
    });
    child.stderr.on("data", (d) => {
      stderr += d.toString();
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({ ok: false, text: "", calls: [], cost_usd_cli_total: 0, error: `spawn:${err.message}`, timedOut, exitCode: null });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (timedOut) {
        resolve({ ok: false, text: "", calls: [], cost_usd_cli_total: 0, error: "timeout", timedOut: true, exitCode: code });
        return;
      }
      let obj = null;
      try {
        obj = JSON.parse(stdout.trim());
      } catch (_e) {
        // Fall back: scan for the last JSON object on stdout.
        const start = stdout.indexOf("{");
        const end = stdout.lastIndexOf("}");
        if (start !== -1 && end > start) {
          try {
            obj = JSON.parse(stdout.slice(start, end + 1));
          } catch (_e2) {
            obj = null;
          }
        }
      }
      if (!obj) {
        resolve({
          ok: false,
          text: "",
          calls: [],
          cost_usd_cli_total: 0,
          error: `unparseable-output (exit ${code})`,
          stderr: stderr.slice(-2000),
          timedOut: false,
          exitCode: code,
        });
        return;
      }
      resolve({ ...parseResult(obj), timedOut: false, exitCode: code });
    });
  });
}

module.exports = { parseResult, buildArgs, runClaude };
