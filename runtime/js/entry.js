#!/usr/bin/env node
/**
 * IranCrypto Tracker — JS entry (bundled to dist/track.cjs).
 * Scrapers are loaded via generated/js-scraper-imports.js
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { SCRAPERS } from "../../generated/js-scraper-imports.js";
import { logError, logInfo } from "./logger.js";
import { envBool, getIngestRetryCount, getTimeoutSec } from "./vars.js";

function resolveBaseDir() {
  // Prefer directory of the running script (dist/track.js on workers)
  const exec = process.argv[1] ? path.resolve(process.argv[1]) : process.cwd();
  if (exec.startsWith("/$bunfs")) {
    return process.cwd();
  }
  return path.dirname(exec);
}

function isLambdaRuntime() {
  return Boolean(process.env.AWS_LAMBDA_FUNCTION_NAME);
}

function resolveLogDir(baseDir) {
  if (process.env.LOG_DIR) return process.env.LOG_DIR;
  if (isLambdaRuntime()) return "/tmp/irancrypto-logs";
  return path.join(baseDir, "logs");
}

function resolveNodeId() {
  if (process.env.INGEST_NODE) return process.env.INGEST_NODE;
  if (isLambdaRuntime()) return process.env.AWS_LAMBDA_FUNCTION_NAME || "lambda";
  return os.hostname() || "js";
}

function applyLambdaDefaults() {
  if (!isLambdaRuntime()) return;
  if (!process.env.LOG_DIR) process.env.LOG_DIR = "/tmp/irancrypto-logs";
  if (!process.env.INGEST_NODE && process.env.AWS_LAMBDA_FUNCTION_NAME) {
    process.env.INGEST_NODE = process.env.AWS_LAMBDA_FUNCTION_NAME;
  }
}

/** @param {Record<string, unknown>} event */
function argvFromLambdaEvent(event) {
  const raw = process.env.TRACK_ARGS?.trim();
  if (raw) {
    return ["node", "track.cjs", ...raw.split(/\s+/).filter(Boolean)];
  }
  const e = event && typeof event === "object" ? event : {};
  const args = ["node", "track.cjs"];
  if (e.finalize_only || e.finalizeOnly) {
    args.push("--finalize-only");
  } else if (e.exchange) {
    args.push(`--exchange=${String(e.exchange).toLowerCase()}`);
  } else {
    args.push("--all");
  }
  if (e.dry_run || e.dryRun) args.push("--dry-run");
  else if (
    !e.finalize_only &&
    !e.finalizeOnly &&
    e.finalize !== false &&
    (!e.exchange || e.finalize === true)
  ) {
    args.push("--finalize");
  }
  if (e.run_id || e.runId) args.push(`--run-id=${e.run_id ?? e.runId}`);
  if (e.from_json || e.fromJson) {
    args.push(`--from-json=${e.from_json ?? e.fromJson}`);
  }
  return args;
}

function loadDotenv(filePath) {
  if (!fs.existsSync(filePath)) return;
  const text = fs.readFileSync(filePath, "utf8");
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const eq = trimmed.indexOf("=");
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
}

function parseCli(argv) {
  const out = {
    all: false,
    exchange: null,
    finalize: false,
    finalizeOnly: false,
    runId: null,
    dryRun: false,
    fromJson: null,
    pruneLogs: false,
    help: false,
  };
  for (const arg of argv.slice(2)) {
    if (arg === "--help" || arg === "-h") out.help = true;
    else if (arg === "--all") out.all = true;
    else if (arg === "--finalize") out.finalize = true;
    else if (arg === "--finalize-only") out.finalizeOnly = true;
    else if (arg === "--dry-run") out.dryRun = true;
    else if (arg === "--prune-logs") out.pruneLogs = true;
    else if (arg.startsWith("--exchange="))
      out.exchange = arg.slice("--exchange=".length).toLowerCase();
    else if (arg.startsWith("--run-id=")) out.runId = arg.slice("--run-id=".length);
    else if (arg.startsWith("--from-json=")) out.fromJson = arg.slice("--from-json=".length);
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return out;
}

const DEFAULT_INGEST_URL = "https://irancrypto.market/api/ingest";

function resolveIngestBase(raw) {
  let base = (raw && String(raw).trim()) || DEFAULT_INGEST_URL;
  base = base.replace(/\/$/, "");
  if (!/\/api\/ingest(\/|$)/.test(base)) {
    base = `${base.replace(/\/$/, "")}/api/ingest`;
  }
  return base.replace(/\/$/, "");
}

function ingestUrl(path) {
  const base = resolveIngestBase(process.env.INGEST_URL);
  if (!path || path === "/") return base;
  return `${base}${path.startsWith("/") ? path : `/${path}`}`;
}

function printHelp() {
  console.log(`IranCrypto tracker (JS) — API-only single-file worker

Usage:
  node track.cjs --all [--finalize]
  node track.cjs --exchange=nobitex
  node track.cjs --finalize-only [--run-id=YYYY-MM-DDTHH]
  node track.cjs --from-json=rows.json
  node track.cjs --prune-logs

Env: INGEST_SECRET (required) INGEST_URL INGEST_NODE LOG_DIR EXCHANGES IGNORE_EXCHANGES
     FINALIZE_WAIT_SEC (default 300) FINALIZE_POLL_SEC (default 15)
     INGEST_URL defaults to ${DEFAULT_INGEST_URL}
     Only one node should --finalize (Lambda). Other nodes scrape without --finalize.
     AWS Lambda: handler track.handler; LOG_DIR defaults to /tmp/irancrypto-logs
`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function envInt(name, fallback, min = 0) {
  const n = Number.parseInt(process.env[name] || String(fallback), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, n);
}

/** Wall-clock ms after which this process must give up waiting. Set by the Lambda handler. */
let runDeadlineMs = null;

/**
 * Seconds left before the runtime kills us, minus a safety margin for the
 * finalize POST and log flushing. Falls back to a conservative value off-Lambda.
 * @returns {number}
 */
function resolveFinalizeBudgetSec() {
  const configured = envInt("LAMBDA_TIMEOUT_SEC", 300, 30);
  const marginSec = envInt("FINALIZE_SAFETY_SEC", 45, 5);
  const totalSec = runDeadlineMs ? (runDeadlineMs - Date.now()) / 1000 : configured;
  return Math.max(0, Math.floor(totalSec - marginSec));
}

function defaultRunId(d = new Date()) {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  const h = String(d.getUTCHours()).padStart(2, "0");
  return `${y}-${m}-${day}T${h}`;
}

function csvList(value) {
  return (value || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

class RunLogger {
  constructor(logDir, node, runId) {
    fs.mkdirSync(logDir, { recursive: true });
    const day = runId.slice(0, 10);
    const dayDir = path.join(logDir, day);
    fs.mkdirSync(dayDir, { recursive: true });
    const safeNode = String(node).replace(/[^a-zA-Z0-9._-]+/g, "_") || "node";
    const safeRun = String(runId).replace(/[^a-zA-Z0-9._-]+/g, "_") || "run";
    this.filePath = path.join(dayDir, `${safeNode}-${safeRun}.jsonl`);
  }

  event(event, data = {}) {
    const row = { ts: new Date().toISOString(), event, ...data };
    fs.appendFileSync(this.filePath, `${JSON.stringify(row)}\n`);
  }
}

function pruneLogs(logDir, days) {
  if (!fs.existsSync(logDir)) return 0;
  const cutoff = Date.now() - days * 86400 * 1000;
  let removed = 0;
  const walk = (dir) => {
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name);
      const st = fs.statSync(full);
      if (st.isDirectory()) {
        walk(full);
        try {
          if (fs.readdirSync(full).length === 0) fs.rmdirSync(full);
        } catch {
          /* ignore */
        }
      } else if (st.mtimeMs < cutoff) {
        fs.unlinkSync(full);
        removed++;
      }
    }
  };
  walk(logDir);
  return removed;
}

const INGEST_RETRY_BASE_MS = 1000;
// Failures where no request reached the server, so a retry cannot duplicate an ingest write.
const INGEST_RETRYABLE =
  /ENOTFOUND|EAI_AGAIN|ETIMEOUT\b|ECONNREFUSED|EHOSTUNREACH|ENETUNREACH|ConnectionRefused|UND_ERR_CONNECT_TIMEOUT|getaddrinfo/;

function isRetryableIngestError(error) {
  if (error?.response) return false;
  return INGEST_RETRYABLE.test(`${error?.code} ${error?.cause?.code} ${error?.message}`);
}

async function withIngestRetry(label, send) {
  const retries = getIngestRetryCount();
  for (let attempt = 1; ; attempt++) {
    try {
      return await send();
    } catch (error) {
      if (attempt > retries || !isRetryableIngestError(error)) throw error;
      const delay = INGEST_RETRY_BASE_MS * 2 ** (attempt - 1);
      logInfo(
        `Ingest ${label} failed: ${error.message} — retry ${attempt}/${retries} in ${delay}ms`,
      );
      await sleep(delay);
    }
  }
}

async function ingestRequest(method, urlPath, body) {
  const secret = process.env.INGEST_SECRET || "";
  if (!secret) {
    throw new Error("INGEST_SECRET is required");
  }
  const url = ingestUrl(urlPath);
  const headers = {
    Accept: "application/json",
    Authorization: `Bearer ${secret}`,
    "User-Agent":
      process.env.USER_AGENT ||
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
  };
  const verifyIngest = envBool("SSL_VERIFY_INGEST", true);
  const timeoutMs = Math.max(getTimeoutSec() * 1000, 60_000);

  // Default path: native fetch (system CA verify). When SSL_VERIFY_INGEST=false, use axios.
  if (!verifyIngest) {
    const https = await import("node:https");
    const axios = (await import("axios")).default;
    const conf = {
      method,
      url,
      headers,
      timeout: timeoutMs,
      httpsAgent: new https.Agent({ rejectUnauthorized: false }),
      validateStatus: (s) => s >= 200 && s < 300,
    };
    if (body !== undefined) conf.data = body;
    const res = await withIngestRetry(`${method} ${urlPath}`, () => axios(conf));
    return res.data || {};
  }

  const init = { method, headers };
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(body);
  }
  const res = await withIngestRetry(`${method} ${urlPath}`, () =>
    fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) }),
  );
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  if (!res.ok) {
    const msg = (json && (json.error || json.message)) || text || res.statusText;
    throw new Error(`Ingest HTTP ${res.status}: ${msg}`);
  }
  return json || {};
}

/**
 * Poll GET /status until missing=[] or the deadline.
 * Always resolves: a status failure or a permanently down source must degrade
 * the run to whatever arrived, never abort the finalize that follows.
 * @returns {Promise<{missing: string[]}>}
 */
async function waitForIngestReady(runId, logger) {
  // Never wait past the point where the remaining runtime budget cannot finish.
  const budgetSec = resolveFinalizeBudgetSec();
  const waitSec = Math.min(envInt("FINALIZE_WAIT_SEC", 90, 0), budgetSec);
  const pollSec = envInt("FINALIZE_POLL_SEC", 15, 1);
  const deadline = Date.now() + waitSec * 1000;
  let lastStatus = { missing: [] };

  for (;;) {
    try {
      lastStatus = await ingestRequest("GET", `/status?run_id=${encodeURIComponent(runId)}`);
    } catch (err) {
      logError(err);
      logger.event("status_err", {
        run_id: runId,
        message: err instanceof Error ? err.message : String(err),
      });
    }

    const missing = Array.isArray(lastStatus.missing) ? lastStatus.missing : [];
    if (missing.length === 0) {
      logInfo(`Ingest ready for ${runId}`);
      logger.event("status_ready", { run_id: runId });
      return lastStatus;
    }

    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) {
      logInfo(
        `Finalize wait deadline reached for ${runId}; proceeding with available sources (missing: ${missing.join(",")})`,
      );
      logger.event("status_timeout", {
        run_id: runId,
        missing,
        waited_sec: waitSec,
      });
      return lastStatus;
    }

    const sleepMs = Math.min(pollSec * 1000, remainingMs);
    logInfo(`Waiting for sources (${missing.join(",")}); poll in ${Math.round(sleepMs / 1000)}s`);
    logger.event("status_wait", { run_id: runId, missing, sleep_ms: sleepMs });
    await sleep(sleepMs);
  }
}

async function finalizeWhenReady(runId, logger) {
  const t0 = Date.now();
  await waitForIngestReady(runId, logger);
  await ingestRequest("POST", "/finalize", {
    run_id: runId,
    stage: "all",
  });
  logger.event("finalize_ok", { run_id: runId, ms: Date.now() - t0 });
  logInfo("Finalize complete");
}

async function asyncPool(items, iteratorFn, concurrency = 6) {
  const results = [];
  const executing = new Set();
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const p = Promise.resolve().then(() => iteratorFn(item, i));
    results.push(p);
    executing.add(p);
    const clean = () => executing.delete(p);
    p.then(clean, clean);
    if (executing.size >= concurrency) {
      await Promise.race(executing);
    }
  }
  return Promise.all(results);
}

function filterRows(raw, coins) {
  const coinSet = new Set(coins.map((c) => String(c).toUpperCase()));
  const out = [];
  for (const d of raw) {
    if (!d || typeof d !== "object") continue;
    const price = Number(d.price);
    if (!Number.isFinite(price) || price <= 0) continue;
    const vol = d.volume_1d != null ? Number(d.volume_1d) : 0;
    if (!Number.isFinite(vol) || vol < 0) continue;
    if (!d.source || typeof d.source !== "string") continue;
    const sym = String(d.symbol || "")
      .toUpperCase()
      .trim();
    if (!sym || !coinSet.has(sym)) continue;

    const row = {
      symbol: sym,
      currency: String(d.currency || "IRR")
        .toUpperCase()
        .trim(),
      price: price,
      volume_1d: Math.max(0, vol),
      source: String(d.source).toLowerCase().trim(),
    };
    if (d.coin_volume_1d != null) {
      const cv = Number(d.coin_volume_1d);
      if (Number.isFinite(cv) && cv >= 0) row.coin_volume_1d = cv;
    }
    if (d.change_1d != null) {
      const c1d = Number(d.change_1d);
      if (Number.isFinite(c1d)) row.change_1d = c1d;
    }
    if (d.change_7d != null) {
      const c7d = Number(d.change_7d);
      if (Number.isFinite(c7d)) row.change_7d = c7d;
    }
    if (d.cap != null) {
      const cap = Number(d.cap);
      if (Number.isFinite(cap) && cap >= 0) row.cap = cap;
    } else if (d.market_cap != null) {
      const mcap = Number(d.market_cap);
      if (Number.isFinite(mcap) && mcap >= 0) row.cap = mcap;
    }
    if (d.supply != null) {
      const supply = Number(d.supply);
      if (Number.isFinite(supply) && supply >= 0) row.supply = supply;
    }
    if (d.max_supply != null) {
      const maxSupply = Number(d.max_supply);
      if (Number.isFinite(maxSupply) && maxSupply >= 0) row.max_supply = maxSupply;
    }
    out.push(row);
  }
  return out;
}

function selectExchanges(exchanges, cli) {
  const ignored = csvList(process.env.IGNORE_EXCHANGES);
  let allow = csvList(process.env.EXCHANGES);
  if (cli.exchange) allow = [cli.exchange];

  const raw = [...exchanges];
  const existingSlugs = new Set(raw.map((e) => String(e.slug || "").toLowerCase()));
  for (const slug of Object.keys(SCRAPERS)) {
    if (!existingSlugs.has(slug.toLowerCase())) {
      raw.push({ slug });
    }
  }

  return raw.filter((ex) => {
    const slug = String(ex.slug || "").toLowerCase();
    if (!slug) return false;
    if (ignored.includes(slug)) return false;
    if (allow.length && !allow.includes(slug)) return false;
    return true;
  });
}

async function scrapeOne(exchange, coins) {
  const slug = String(exchange.slug).toLowerCase();
  const mod = SCRAPERS[slug];
  if (!mod?.scrape) {
    logInfo(`No JS scraper for: ${slug}`);
    return [];
  }
  const filter =
    mod.COIN_USE === "own" ? (exchange.support || []).map((c) => String(c).toUpperCase()) : coins;
  const t0 = Date.now();
  logInfo(`Processing ${slug} exchange started`);
  const result = await mod.scrape(filter);
  logInfo(`Processing ${slug} finished in ${Math.round((Date.now() - t0) / 1000)}s`);
  return Array.isArray(result) ? result : [];
}

async function runTrack(customArgv, context = null) {
  applyLambdaDefaults();
  const argv = customArgv ?? process.argv;
  const baseDir = resolveBaseDir();
  loadDotenv(path.join(baseDir, ".env"));
  loadDotenv(path.join(process.cwd(), ".env"));

  const cli = parseCli(argv);
  if (cli.help) {
    printHelp();
    return 0;
  }

  const logDir = resolveLogDir(baseDir);
  const retention = Math.max(1, Number.parseInt(process.env.LOG_RETENTION_DAYS || "7", 10) || 7);
  const nodeId = resolveNodeId();

  runDeadlineMs =
    context && typeof context.getRemainingTimeInMillis === "function"
      ? Date.now() + context.getRemainingTimeInMillis()
      : null;

  if (cli.pruneLogs && !cli.all && !cli.exchange && !cli.finalizeOnly && !cli.fromJson) {
    const n = pruneLogs(logDir, retention);
    logInfo(`Pruned ${n} log file(s) older than ${retention} days`);
    return 0;
  }

  let runId = cli.runId || defaultRunId();
  const logger = new RunLogger(logDir, nodeId, runId);
  logInfo(`IranCrypto track.js starting run_id=${runId}`);
  logInfo(`Logs: ${logger.filePath}`);
  logger.event("run_start", {
    run_id: runId,
    node: nodeId,
    dry_run: cli.dryRun,
  });

  if (cli.finalizeOnly) {
    if (cli.dryRun) {
      logInfo(`Dry-run: would finalize ${runId}`);
      logger.event("run_end", { ok: true, dry_run: true });
      return 0;
    }
    try {
      await finalizeWhenReady(runId, logger);
      pruneLogs(logDir, retention);
      logger.event("run_end", { ok: true });
      return 0;
    } catch (err) {
      logError(err);
      logger.event("finalize_err", {
        message: err instanceof Error ? err.message : String(err),
      });
      logger.event("run_end", { ok: false });
      return 1;
    }
  }

  if (!cli.all && !cli.exchange && !cli.fromJson) {
    logError("Specify --all, --exchange=SLUG, --from-json=, or --finalize-only");
    printHelp();
    return 1;
  }

  const config = await ingestRequest("GET", "/config");
  logger.event("config_ok", {
    exchanges: (config.exchanges || []).length,
    coins: (config.coins || []).length,
  });
  if (!cli.runId && config.run_id_default) runId = String(config.run_id_default);

  const exchanges = selectExchanges(config.exchanges || [], cli);
  const coins = (config.coins || []).map((c) => String(c).toUpperCase());
  logger.event("run_start", {
    run_id: runId,
    node: nodeId,
    exchanges: exchanges.map((e) => e.slug),
  });

  /** @type {Record<string, object[]>} */
  const bySource = {};

  if (cli.fromJson) {
    const decoded = JSON.parse(fs.readFileSync(cli.fromJson, "utf8"));
    const rows = Array.isArray(decoded?.rows) ? decoded.rows : decoded;
    for (const row of rows) {
      if (!row?.source) continue;
      const src = String(row.source).toLowerCase();
      if (!bySource[src]) bySource[src] = [];
      bySource[src].push(row);
    }
  } else {
    if (!exchanges.length || !coins.length) {
      logError("No exchanges or coins from config");
      return 1;
    }
    const scraped = [];
    const concurrency = Math.max(1, parseInt(process.env.SCRAPER_CONCURRENCY || "6", 10));
    await asyncPool(
      exchanges,
      async (ex) => {
        try {
          const rows = await scrapeOne(ex, coins);
          scraped.push(...rows);
          logger.event("scrape_ok", {
            source: String(ex.slug).toLowerCase(),
            rows: rows.length,
          });
        } catch (err) {
          logError(err);
          logger.event("scrape_err", {
            source: String(ex.slug).toLowerCase(),
            message: err instanceof Error ? err.message : String(err),
          });
        }
      },
      concurrency,
    );
    const filtered = filterRows(scraped, coins);
    logInfo(
      `Discovered ${filtered.length} filtered rows from ${new Set(filtered.map((r) => r.source)).size} sources`,
    );
    for (const row of filtered) {
      if (!bySource[row.source]) bySource[row.source] = [];
      bySource[row.source].push(row);
    }
  }

  const collectedAt = new Date().toISOString();
  let ok = true;

  for (const [source, rows] of Object.entries(bySource)) {
    const payload = {
      run_id: runId,
      mode: "partial",
      source,
      collected_at: collectedAt,
      node: nodeId,
      rows,
      finalize: false,
    };
    if (cli.dryRun) {
      logInfo(`Dry-run: would ingest ${source} rows=${rows.length}`);
      logger.event("ingest_skip", {
        source,
        reason: "dry_run",
        rows: rows.length,
      });
      continue;
    }
    try {
      const t0 = Date.now();
      const res = await ingestRequest("POST", "", payload);
      logger.event("ingest_ok", {
        source,
        rows: rows.length,
        upserted: res.upserted ?? null,
        skipped: res.skipped ?? null,
        http: 200,
        ms: Date.now() - t0,
      });
      logInfo(`Ingested ${source}: rows=${rows.length}`);
    } catch (err) {
      ok = false;
      logError(err);
      logger.event("ingest_err", {
        source,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (cli.finalize && !cli.dryRun) {
    try {
      await finalizeWhenReady(runId, logger);
    } catch (err) {
      ok = false;
      logError(err);
      logger.event("finalize_err", {
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const pruned = pruneLogs(logDir, retention);
  if (pruned) logInfo(`Pruned ${pruned} old log file(s)`);
  logger.event("run_end", { ok });
  return ok ? 0 : 1;
}

/** AWS Lambda entry — use handler `track.handler` with EventBridge schedule. */
export async function handler(event = {}, context = {}) {
  applyLambdaDefaults();
  const argv = argvFromLambdaEvent(event);
  const code = await runTrack(argv, context);
  return {
    statusCode: code === 0 ? 200 : 500,
    body: JSON.stringify({
      ok: code === 0,
      exitCode: code,
      node: resolveNodeId(),
      runArgs: argv.slice(2),
    }),
  };
}

export { runTrack };

function shouldRunCli() {
  // CJS bundle (dist/track.js): require.main === module
  // ESM modular (runtime/js/entry.js): compare import.meta.url to argv[1]
  let isMain = false;
  if (typeof require !== "undefined") {
    try {
      isMain = require.main === module;
    } catch {
      isMain = false;
    }
  }
  if (!isMain) {
    try {
      const entry = process.argv[1] ? path.resolve(process.argv[1]) : "";
      isMain = Boolean(entry) && pathToFileURL(entry).href === import.meta.url;
    } catch {
      isMain = false;
    }
  }
  if (!isMain) return false;
  if (!isLambdaRuntime()) return true;
  return process.argv.slice(2).length > 0;
}

if (shouldRunCli()) {
  const shutdown = (signal) => {
    logInfo(`Received ${signal}, shutting down gracefully...`);
    process.exit(128 + (signal === "SIGINT" ? 2 : 15));
  };
  process.once("SIGINT", () => shutdown("SIGINT"));
  process.once("SIGTERM", () => shutdown("SIGTERM"));

  runTrack()
    .then((code) => process.exit(code ?? 0))
    .catch((err) => {
      logError(err);
      process.exit(1);
    });
}
