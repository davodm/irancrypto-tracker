#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function run(script) {
  const r = spawnSync(process.execPath, [path.join(root, "scripts", script)], {
    stdio: "inherit",
    cwd: root,
  });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

run("check-parity.mjs");
run("generate-registry.mjs");
run("build-js.mjs");
run("build-php.mjs");
run("build-python.mjs");
console.log("Build complete: dist/track.cjs, dist/track.php, dist/track.py");
