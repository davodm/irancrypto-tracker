#!/usr/bin/env node
/**
 * IranCrypto Tracker — JS entry (bundled to dist/track.js).
 * Scrapers are loaded via generated/js-scraper-imports.js
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { logError, logInfo } from "./logger.js";
import { envBool, getTimeoutSec } from "./vars.js";
import { SCRAPERS } from "../../generated/js-scraper-imports.js";

function resolveBaseDir() {
  // Prefer directory of the running script (dist/track.js on workers)
  const exec = process.argv[1] ? path.resolve(process.argv[1]) : process.cwd();
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
    return ["node", "track.js", ...raw.split(/\s+/).filter(Boolean)];
  }
  const e = event && typeof event === "object" ? event : {};
  const args = ["node", "track.js"];
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
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
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
    else if (arg.startsWith("--from-json="))
      out.fromJson = arg.slice("--from-json=".length);
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
  node track.js --all [--finalize]
  node track.js --exchange=nobitex
  node track.js --finalize-only [--run-id=YYYY-MM-DDTHH]
  node track.js --from-json=rows.json
  node track.js --prune-logs

Env: INGEST_SECRET (required) INGEST_URL INGEST_NODE LOG_DIR EXCHANGES IGNORE_EXCHANGES
     INGEST_URL defaults to ${DEFAULT_INGEST_URL}
     AWS Lambda: set handler to track.handler (EventBridge schedule); LOG_DIR defaults to /tmp/irancrypto-logs
`);
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

async function ingestRequest(method, urlPath, body) {
  const secret = process.env.INGEST_SECRET || "";
  if (!secret) {
    throw new Error("INGEST_SECRET is required");
  }
  const url = ingestUrl(urlPath);
  const headers = {
    Accept: "application/json",
    Authorization: `Bearer ${secret}`,
    "User-Agent": process.env.USER_AGENT || "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
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
    const res = await axios(conf);
    return res.data || {};
  }

  const init = {
    method,
    headers,
    signal: AbortSignal.timeout(timeoutMs),
  };
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(body);
  }
  const res = await fetch(url, init);
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  if (!res.ok) {
    const msg =
      (json && (json.error || json.message)) || text || res.statusText;
    throw new Error(`Ingest HTTP ${res.status}: ${msg}`);
  }
  return json || {};
}

function filterRows(raw, coins) {
  const coinSet = new Set(coins.map((c) => String(c).toUpperCase()));
  const out = [];
  for (const d of raw) {
    if (!d?.price || d.price <= 0) continue;
    if (!d?.volume_1d || d.volume_1d <= 0) continue;
    if (!d?.source) continue;
    const sym = String(d.symbol || "").toUpperCase();
    if (!sym || !coinSet.has(sym)) continue;
    const row = {
      symbol: sym,
      currency: String(d.currency || "IRR").toUpperCase(),
      price: Number(d.price),
      volume_1d: Number(d.volume_1d),
      source: String(d.source).toLowerCase(),
    };
    if (d.coin_volume_1d != null) row.coin_volume_1d = Number(d.coin_volume_1d);
    if (d.change_1d != null) row.change_1d = Number(d.change_1d);
    if (d.change_7d != null) row.change_7d = Number(d.change_7d);
    if (d.market_cap != null) row.market_cap = Number(d.market_cap);
    if (d.supply != null) row.supply = Number(d.supply);
    if (d.max_supply != null) row.max_supply = Number(d.max_supply);
    out.push(row);
  }
  return out;
}

function selectExchanges(exchanges, cli) {
  const ignored = csvList(process.env.IGNORE_EXCHANGES);
  let allow = csvList(process.env.EXCHANGES);
  if (cli.exchange) allow = [cli.exchange];
  return exchanges.filter((ex) => {
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
    mod.COIN_USE === "own"
      ? (exchange.support || []).map((c) => String(c).toUpperCase())
      : coins;
  const t0 = Date.now();
  logInfo(`Processing ${slug} exchange started`);
  const result = await mod.scrape(filter);
  logInfo(`Processing ${slug} finished in ${Math.round((Date.now() - t0) / 1000)}s`);
  return Array.isArray(result) ? result : [];
}

async function runTrack(customArgv) {
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
  const retention = Math.max(
    1,
    Number.parseInt(process.env.LOG_RETENTION_DAYS || "7", 10) || 7
  );
  const nodeId = resolveNodeId();

  if (
    cli.pruneLogs &&
    !cli.all &&
    !cli.exchange &&
    !cli.finalizeOnly &&
    !cli.fromJson
  ) {
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
    const t0 = Date.now();
    await ingestRequest("POST", "/finalize", {
      run_id: runId,
      stage: "all",
    });
    logger.event("finalize_ok", { run_id: runId, ms: Date.now() - t0 });
    pruneLogs(logDir, retention);
    logger.event("run_end", { ok: true });
    return 0;
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
      (bySource[src] ||= []).push(row);
    }
  } else {
    if (!exchanges.length || !coins.length) {
      logError("No exchanges or coins from config");
      return 1;
    }
    const scraped = [];
    for (const ex of exchanges) {
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
    }
    const filtered = filterRows(scraped, coins);
    logInfo(
      `Discovered ${filtered.length} filtered rows from ${new Set(filtered.map((r) => r.source)).size} sources`
    );
    for (const row of filtered) {
      (bySource[row.source] ||= []).push(row);
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
      const t0 = Date.now();
      await ingestRequest("POST", "/finalize", {
        run_id: runId,
        stage: "all",
      });
      logger.event("finalize_ok", { run_id: runId, ms: Date.now() - t0 });
      logInfo("Finalize complete");
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
export async function handler(event = {}, _context = {}) {
  applyLambdaDefaults();
  const argv = argvFromLambdaEvent(event);
  const code = await runTrack(argv);
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
      isMain =
        Boolean(entry) &&
        pathToFileURL(entry).href === import.meta.url;
    } catch {
      isMain = false;
    }
  }
  if (!isMain) return false;
  if (!isLambdaRuntime()) return true;
  return process.argv.slice(2).length > 0;
}

if (shouldRunCli()) {
  runTrack()
    .then((code) => process.exit(code ?? 0))
    .catch((err) => {
      logError(err);
      process.exit(1);
    });
}
