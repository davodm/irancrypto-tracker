#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { listSlugs, projectRoot } from "./lib-slugs.mjs";

const root = projectRoot();
const slugs = listSlugs();
const out = path.join(root, "dist/track.php");

function read(p) {
  return fs.readFileSync(p, "utf8");
}

function stripPhpOpen(src) {
  return src.replace(/^\s*<\?php\s*/m, "");
}

const parts = [];
parts.push(read(path.join(root, "runtime/php/boot.php")).trimEnd());
parts.push("\n\n// ===== helpers =====\n");
parts.push(stripPhpOpen(read(path.join(root, "runtime/php/helpers.php"))));
parts.push("\n\n// ===== scrapers =====\n");
for (const slug of slugs) {
  parts.push(`\n// --- ${slug} ---\n`);
  parts.push(stripPhpOpen(read(path.join(root, "scrapers", slug, "scrape.php"))));
}
parts.push("\n\n// ===== registry =====\n");
parts.push(stripPhpOpen(read(path.join(root, "generated/php-scraper-registry.php"))));
parts.push("\n\n// ===== orchestrator =====\n");
parts.push(stripPhpOpen(read(path.join(root, "runtime/php/orchestrator.php"))));
parts.push("\n\n// ===== main =====\n");
parts.push(read(path.join(root, "runtime/php/main.php")).trimStart());

fs.writeFileSync(out, parts.join("\n") + "\n");
console.log(`Wrote dist/track.php (${slugs.length} scrapers)`);
