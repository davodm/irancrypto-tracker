/**
 * Runtime config — read lazily so entry.js can loadDotenv() before first HTTP call.
 */

/** @param {string} key @param {boolean} defaultValue */
export function envBool(key, defaultValue) {
  const raw = process.env[key];
  if (raw === undefined || raw === "") return defaultValue;
  return /^(1|true|yes|on)$/i.test(String(raw).trim());
}

/** Seconds; falls back to 10 on missing/invalid. */
export function getTimeoutSec() {
  const n = Number.parseInt(process.env.TIMEOUT ?? "10", 10);
  return Number.isFinite(n) && n > 0 ? n : 10;
}

/** Retries after the first ingest attempt on connection-level failures; falls back to 3. */
export function getIngestRetryCount() {
  const n = Number.parseInt(process.env.INGEST_RETRY_COUNT ?? "3", 10);
  return Number.isFinite(n) && n >= 0 ? n : 3;
}

export function getUserAgent() {
  return (
    process.env.USER_AGENT ||
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36"
  );
}

export function getUserAgentPostman() {
  return "PostmanRuntime/7.26.10";
}

export function getProxyUrl() {
  return process.env.PROXY_URL || "";
}
