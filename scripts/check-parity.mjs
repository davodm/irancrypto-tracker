#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { listSlugs, projectRoot, scrapersRoot } from "./lib-slugs.mjs";

const _root = projectRoot();
const scrapers = scrapersRoot();
const required = ["scrape.js", "scrape.php", "scrape.py"];

let failed = false;
const dirs = fs
  .readdirSync(scrapers, { withFileTypes: true })
  .filter((d) => d.isDirectory() && !d.name.startsWith("."))
  .map((d) => d.name)
  .sort();

if (dirs.length === 0) {
  console.error("No scrapers/* directories found");
  process.exit(1);
}

for (const slug of dirs) {
  const base = path.join(scrapers, slug);
  for (const file of required) {
    const full = path.join(base, file);
    if (!fs.existsSync(full)) {
      console.error(`MISSING ${slug}/${file}`);
      failed = true;
    }
  }
  if (!fs.existsSync(path.join(base, "sample.json"))) {
    console.warn(`WARN ${slug}/sample.json missing (raw API dump recommended)`);
  }
}

const complete = listSlugs();
if (complete.length !== dirs.length) {
  console.error(`Parity incomplete: ${complete.length}/${dirs.length} slugs have all three files`);
  failed = true;
}

if (failed) {
  process.exit(1);
}

console.log(`Parity OK: ${complete.length} exchanges (${complete.join(", ")})`);
