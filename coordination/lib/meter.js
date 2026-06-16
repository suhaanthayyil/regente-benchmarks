"use strict";

// The single source of cost truth. Maps token counts to USD via prices.json (public
// Anthropic API list prices) across all four token classes (input, output, cache-read,
// cache-write). NEVER assumes $0: a model with no price entry throws, so an unpriced
// call can't silently look free. Every computed cost is cross-checked against the CLI's
// own reported costUSD (the provider's number) and a divergence beyond tolerance is
// flagged — that catches a stale price table before it can distort the headline.

// Resolve a model's price row. Exact match first; then tolerate a dated suffix
// (e.g. "claude-sonnet-4-6-20250101" -> "claude-sonnet-4-6") so a CLI-reported id with
// a date still prices correctly. Throws if nothing matches.
function priceFor(prices, model) {
  const models = (prices && prices.models) || {};
  if (models[model]) return models[model];
  const undated = String(model).replace(/-\d{8}$/, "");
  if (models[undated]) return models[undated];
  for (const key of Object.keys(models)) {
    const keyUndated = key.replace(/-\d{8}$/, "");
    if (model === key || model.startsWith(key) || undated === keyUndated) return models[key];
  }
  throw new Error(
    `meter: no price entry for model "${model}". Add it to prices.json — refusing to price a call at $0.`,
  );
}

const PER_MILLION = 1e6;

// USD for a single call record {model, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost_usd_cli}.
function costOfCall(prices, call) {
  const p = priceFor(prices, call.model);
  const by_class = {
    input: ((call.input_tokens || 0) * (p.input || 0)) / PER_MILLION,
    output: ((call.output_tokens || 0) * (p.output || 0)) / PER_MILLION,
    cache_read: ((call.cache_read_tokens || 0) * (p.cache_read || 0)) / PER_MILLION,
    cache_write: ((call.cache_write_tokens || 0) * (p.cache_write || 0)) / PER_MILLION,
  };
  const usd = by_class.input + by_class.output + by_class.cache_read + by_class.cache_write;
  return { model: call.model, usd, by_class, cost_usd_cli: call.cost_usd_cli || 0 };
}

// Aggregate a list of call records into total USD + token totals, with a cross-check
// against the summed CLI costUSD. tolerancePct defaults to 5.
function costOfCalls(prices, calls, tolerancePct = 5) {
  const list = Array.isArray(calls) ? calls : [];
  const tokens = { input: 0, output: 0, cache_read: 0, cache_write: 0 };
  let usd = 0;
  let cli_usd = 0;
  const per_call = [];
  for (const call of list) {
    const c = costOfCall(prices, call);
    usd += c.usd;
    cli_usd += c.cost_usd_cli;
    tokens.input += call.input_tokens || 0;
    tokens.output += call.output_tokens || 0;
    tokens.cache_read += call.cache_read_tokens || 0;
    tokens.cache_write += call.cache_write_tokens || 0;
    per_call.push(c);
  }
  const total_tokens = tokens.input + tokens.output + tokens.cache_read + tokens.cache_write;
  const divergence_pct = cli_usd > 0 ? Math.abs(usd - cli_usd) / cli_usd * 100 : 0;
  return {
    usd,
    cli_usd,
    diverged: cli_usd > 0 && divergence_pct > tolerancePct,
    divergence_pct,
    tokens,
    total_tokens,
    per_call,
  };
}

module.exports = { priceFor, costOfCall, costOfCalls };
