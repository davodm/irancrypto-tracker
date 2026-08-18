#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import * as esbuild from "esbuild";
import { projectRoot } from "./lib-slugs.mjs";

const root = projectRoot();
const out = path.join(root, "dist/track.cjs");

await esbuild.build({
  entryPoints: [path.join(root, "runtime/js/entry.js")],
  bundle: true,
  platform: "node",
  target: "node24",
  format: "cjs",
  outfile: out,
  logLevel: "info",
});

let code = fs.readFileSync(out, "utf8");
code = code.replace(/^#!\/usr\/bin\/env node\n?/gm, "");
fs.writeFileSync(out, `#!/usr/bin/env node\n${code}`);
console.log("Wrote dist/track.cjs");
