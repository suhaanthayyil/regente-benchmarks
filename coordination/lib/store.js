"use strict";

// Filesystem + cache helpers for the routing benchmark. Mirrors the atomic-write
// discipline in server/regente-core.js (temp file + rename) so a crash mid-write can
// never leave a half-written results.json. Also provides the rerun cache: a completed
// (instance, arm, version-hash) outcome is cached so a rerun never repays for it, and
// a Max rate-limit interruption just pauses progress instead of losing work.

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function atomicWrite(filePath, contents) {
  ensureDir(path.dirname(filePath));
  const tmp = `${filePath}.tmp-${process.pid}-${crypto.randomBytes(4).toString("hex")}`;
  fs.writeFileSync(tmp, contents);
  fs.renameSync(tmp, filePath);
}

function readJson(filePath, fallback) {
  if (!fs.existsSync(filePath)) return fallback;
  const raw = fs.readFileSync(filePath, "utf8").trim();
  if (!raw) return fallback;
  try {
    return JSON.parse(raw);
  } catch (_error) {
    // Quarantine a corrupt file rather than crash, matching regente-core's behavior.
    try {
      fs.renameSync(filePath, `${filePath}.corrupt-${Date.now()}`);
    } catch (_e) {
      /* best effort */
    }
    return fallback;
  }
}

function writeJson(filePath, value) {
  atomicWrite(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function appendJsonl(filePath, obj) {
  ensureDir(path.dirname(filePath));
  fs.appendFileSync(filePath, `${JSON.stringify(obj)}\n`);
}

function readJsonl(filePath) {
  if (!fs.existsSync(filePath)) return [];
  return fs
    .readFileSync(filePath, "utf8")
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch (_e) {
        return null;
      }
    })
    .filter(Boolean);
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

// A short, stable hash of whatever determines whether a cached outcome is still valid
// (model versions + scaffold version + temperature + gate config). Changing any input
// changes the key, correctly invalidating stale cache entries.
function versionHash(parts) {
  return sha256(JSON.stringify(parts)).slice(0, 16);
}

function cachePath(cacheDir, kind, instanceId, arm, vhash) {
  const safe = String(instanceId).replace(/[^A-Za-z0-9._-]/g, "_");
  return path.join(cacheDir, `${kind}__${safe}__${arm}__${vhash}.json`);
}

function cacheGet(cacheDir, kind, instanceId, arm, vhash) {
  return readJson(cachePath(cacheDir, kind, instanceId, arm, vhash), null);
}

function cachePut(cacheDir, kind, instanceId, arm, vhash, value) {
  writeJson(cachePath(cacheDir, kind, instanceId, arm, vhash), value);
}

module.exports = {
  ensureDir,
  atomicWrite,
  readJson,
  writeJson,
  appendJsonl,
  readJsonl,
  sha256,
  versionHash,
  cachePath,
  cacheGet,
  cachePut,
};
