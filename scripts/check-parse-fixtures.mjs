#!/usr/bin/env node
/**
 * Golden parse fixtures — bitpin / ariomex / nobitex across JS helpers + PHP + Python.
 * Run: node scripts/check-parse-fixtures.mjs
 * PHP/Python are skipped locally if the binary is missing; CI always has them.
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { JSONizeResponse } from "../runtime/js/request.js";
import num from "../runtime/js/num.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixtures = path.join(root, "fixtures/parse");
const requireAll = Boolean(process.env.CI || process.env.REQUIRE_ALL_RUNTIMES);

function readJson(name) {
  return JSON.parse(fs.readFileSync(path.join(fixtures, name), "utf8"));
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function hasBin(bin) {
  const r = spawnSync(bin, ["-v"], { encoding: "utf8" });
  return r.error?.code !== "ENOENT" && (r.status === 0 || Boolean(r.stdout));
}

function run(bin, args, label) {
  if (!hasBin(bin)) {
    if (requireAll) {
      throw new Error(`${label}: ${bin} required in CI`);
    }
    console.warn(`SKIP ${label}: ${bin} not found`);
    return;
  }
  const r = spawnSync(bin, args, { encoding: "utf8" });
  if (r.status !== 0) {
    console.error(r.stdout || "", r.stderr || "");
    throw new Error(`${label} failed`);
  }
}

// --- JS: proxy unwrap + num ---
{
  const wrapped = JSONizeResponse(
    { data: { data: { ok: true, n: 1 } } },
    { unwrapProxy: true }
  );
  assert(wrapped.ok === true && wrapped.n === 1, "proxy unwrap nested data");
  const direct = JSONizeResponse({ data: [{ a: 1 }] }, { unwrapProxy: true });
  assert(Array.isArray(direct) && direct[0].a === 1, "proxy unwrap array passthrough");
  assert(Number(num("12.5", { multiply: 10 })) === 125, "num multiply");
}

// --- JS row filters ---
{
  const bitpin = readJson("bitpin-page.json");
  const coins = ["BTC", "ETH"];
  const rows = bitpin.results.filter((data) => {
    if (data?.currency2?.code !== "IRT") return false;
    if (data?.currency1?.forTest || !data?.order_book_info?.price) return false;
    const code = String(data.currency1.code || "").toUpperCase();
    return coins.includes(code);
  });
  assert(rows.length === 2, `bitpin js filter expected 2, got ${rows.length}`);
}

{
  const ario = readJson("ariomex-page.json");
  const coins = ["BTC", "SOL"];
  const rows = ario.result.filter((data) => {
    if (!data?.last_price || Number(data.last_price) <= 0) return false;
    return coins.includes(String(data.base).toUpperCase());
  });
  assert(rows.length === 2, `ariomex js filter expected 2, got ${rows.length}`);
}

{
  const nob = readJson("nobitex-stats.json");
  const upper = ["btc"].map((c) => c.toUpperCase());
  const rows = [];
  for (const [key, row] of Object.entries(nob.stats)) {
    if (row.isClosed) continue;
    const symbol = String(key).toUpperCase().split("-")[0];
    if (!upper.includes(symbol)) continue;
    if (!row.latest || Number(row.latest) <= 0) continue;
    rows.push(symbol);
  }
  assert(
    rows.length === 1 && rows[0] === "BTC",
    `nobitex casing expected [BTC], got ${JSON.stringify(rows)}`
  );
}

// --- PHP harness file ---
{
  const phpPath = path.join(fixtures, "_harness.php");
  const php = `<?php
declare(strict_types=1);
function num($v, $opts = []) {
  $n = (float)$v;
  if (isset($opts['multiply'])) $n *= (float)$opts['multiply'];
  if (!empty($opts['roundUp'])) $n = ceil($n);
  $dp = $opts['decimalPlaces'] ?? 14;
  return round($n, (int)$dp);
}
function coin_allowed(array $filter, string $symbol): bool {
  if ($filter === []) return true;
  $upper = array_map(static fn($c) => strtoupper((string)$c), $filter);
  return in_array(strtoupper($symbol), $upper, true);
}
function last_update_now(): array {
  $ts = time();
  return ['date' => gmdate('c', $ts), 'timestamp' => $ts];
}
require ${JSON.stringify(path.join(root, "scrapers/bitpin/scrape.php"))};
require ${JSON.stringify(path.join(root, "scrapers/ariomex/scrape.php"))};
require ${JSON.stringify(path.join(root, "scrapers/nobitex/scrape.php"))};
$bitpin = json_decode(file_get_contents(${JSON.stringify(path.join(fixtures, "bitpin-page.json"))}), true);
$out = parse_bitpin_list($bitpin['results'], ['btc', 'ETH']);
if (count($out) !== 2) { fwrite(STDERR, 'bitpin php count '.count($out).PHP_EOL); exit(1); }
$ario = json_decode(file_get_contents(${JSON.stringify(path.join(fixtures, "ariomex-page.json"))}), true);
$out2 = parse_ariomex_list($ario['result'], ['BTC', 'SOL']);
if (count($out2) !== 2) { fwrite(STDERR, 'ariomex php count '.count($out2).PHP_EOL); exit(1); }
$nob = json_decode(file_get_contents(${JSON.stringify(path.join(fixtures, "nobitex-stats.json"))}), true);
$out3 = parse_nobitex($nob, ['btc']);
if (count($out3) !== 1 || ($out3[0]['symbol'] ?? '') !== 'BTC') { fwrite(STDERR, 'nobitex php fail'.PHP_EOL); exit(1); }
echo "php ok\\n";
`;
  fs.writeFileSync(phpPath, php);
  try {
    run("php", [phpPath], "php fixtures");
  } finally {
    fs.unlinkSync(phpPath);
  }
}

// --- Python: extract only parse_* defs ---
{
  const extractParse = (src) => {
    const lines = src.split("\n");
    const out = [];
    let capturing = false;
    for (const line of lines) {
      if (/^def parse_/.test(line)) {
        capturing = true;
        out.push(line);
        continue;
      }
      if (capturing) {
        if (line.trim() === "") {
          out.push(line);
          continue;
        }
        if (/^def /.test(line)) break;
        out.push(line);
      }
    }
    return out.join("\n");
  };

  const pyPath = path.join(fixtures, "_harness.py");
  const py = `from __future__ import annotations
import json, math, time
from typing import Any

def num(v, opts=None):
    opts = opts or {}
    n = float(v or 0)
    if "multiply" in opts:
        n *= float(opts["multiply"])
    if opts.get("roundUp"):
        n = math.ceil(n)
    dp = int(opts.get("decimalPlaces", 14))
    return round(n, dp)

def coin_allowed(filter_coins, symbol):
    if not filter_coins:
        return True
    upper = {c.upper() for c in filter_coins}
    return symbol.upper() in upper

${extractParse(fs.readFileSync(path.join(root, "scrapers/bitpin/scrape.py"), "utf8"))}

${extractParse(fs.readFileSync(path.join(root, "scrapers/ariomex/scrape.py"), "utf8"))}

${extractParse(fs.readFileSync(path.join(root, "scrapers/nobitex/scrape.py"), "utf8"))}

bitpin = json.load(open(${JSON.stringify(path.join(fixtures, "bitpin-page.json"))}))
out = parse_bitpin_list(bitpin["results"], ["btc", "ETH"])
assert len(out) == 2, out
ario = json.load(open(${JSON.stringify(path.join(fixtures, "ariomex-page.json"))}))
out2 = parse_ariomex_list(ario["result"], ["BTC", "SOL"])
assert len(out2) == 2, out2
nob = json.load(open(${JSON.stringify(path.join(fixtures, "nobitex-stats.json"))}))
out3 = parse_nobitex(nob, ["btc"])
assert len(out3) == 1 and out3[0]["symbol"] == "BTC", out3
print("python ok")
`;
  fs.writeFileSync(pyPath, py);
  try {
    run("python3", [pyPath], "python fixtures");
  } finally {
    fs.unlinkSync(pyPath);
  }
}

console.log("Parse fixtures OK");
