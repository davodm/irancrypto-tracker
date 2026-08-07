#!/usr/bin/env bash
# Package dist/track.js for AWS Lambda (Node.js 24.x / nodejs24.x).
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
out="${root}/irancrypto-tracker-lambda.zip"
rm -f "$out"
(cd "${root}/dist" && zip -j "$out" track.js package.json)
echo "Wrote ${out} ($(du -h "$out" | cut -f1))"
echo "Lambda runtime: nodejs24.x"
echo "Lambda handler: track.handler"
