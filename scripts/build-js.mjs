#!/usr/bin/env node
import * as esbuild from "esbuild";
import fs from "node:fs";
import path from "node:path";
import { projectRoot } from "./lib-slugs.mjs";

const root = projectRoot();
const out = path.join(root, "dist/track.js");

await esbuild.build({
  entryPoints: [path.join(root, "runtime/js/entry.js")],
  bundle: true,
  platform: "node",
  target: "node18",
  format: "cjs",
  outfile: out,
  logLevel: "info",
});

let code = fs.readFileSync(out, "utf8");
code = code.replace(/^#!\/usr\/bin\/env node\n?/gm, "");
fs.writeFileSync(out, `#!/usr/bin/env node\n${code}`);
fs.writeFileSync(
  path.join(root, "dist/package.json"),
  JSON.stringify({ type: "commonjs" }, null, 2) + "\n"
);
console.log("Wrote dist/track.js");
