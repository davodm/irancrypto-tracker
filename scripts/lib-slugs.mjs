#!/usr/bin/env node
/**
 * List exchange slugs under scrapers/ that have all three language files.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scrapersDir = path.join(root, "scrapers");

export function listSlugs() {
  if (!fs.existsSync(scrapersDir)) return [];
  return fs
    .readdirSync(scrapersDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith("."))
    .map((d) => d.name)
    .filter((slug) => {
      const base = path.join(scrapersDir, slug);
      return (
        fs.existsSync(path.join(base, "scrape.js")) &&
        fs.existsSync(path.join(base, "scrape.php")) &&
        fs.existsSync(path.join(base, "scrape.py"))
      );
    })
    .sort();
}

export function scrapersRoot() {
  return scrapersDir;
}

export function projectRoot() {
  return root;
}
