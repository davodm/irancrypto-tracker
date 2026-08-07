#!/usr/bin/env python3
# Make executable: chmod +x track.py
"""
IranCrypto Tracker — single-file API-only collector (Python).

Deploy: copy this file + create logs/ (auto-created). No Mongo, no pip deps.

  export INGEST_SECRET=...
  python3 track.py --all --finalize
  # or: ./track.py --all --finalize   (after chmod +x track.py)

INGEST_URL defaults to https://irancrypto.market/api/ingest (override via env).

Requirements: Python 3.10+ stdlib only.
"""
from __future__ import annotations

import argparse
import json
import math
import os
import random
import re
import socket
import ssl
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

SCRIPT_DIR = Path(__file__).resolve().parent
SCRIPT_STARTED_AT = time.monotonic()


# =============================================================================
# ENV
# =============================================================================


def load_dotenv(path: Path) -> None:
    if not path.is_file():
        return
    try:
        text = path.read_text(encoding="utf-8")
    except OSError:
        return
    for line in text.splitlines():
        trimmed = line.strip()
        if not trimmed or trimmed.startswith("#") or "=" not in trimmed:
            continue
        key, _, val = trimmed.partition("=")
        key = key.strip()
        val = val.strip()
        if not key:
            continue
        if (val.startswith('"') and val.endswith('"')) or (
            val.startswith("'") and val.endswith("'")
        ):
            val = val[1:-1]
        if key not in os.environ:
            os.environ[key] = val


def env(key: str, default: str = "") -> str:
    v = os.environ.get(key)
    if v is None or v == "":
        return default
    return v


def env_bool(key: str, default: bool) -> bool:
    raw = os.environ.get(key)
    if raw is None or raw == "":
        return default
    return raw.strip().lower() in ("1", "true", "yes", "on")


def env_int(key: str, default: int, *, minimum: int | None = None) -> int:
    raw = env(key, str(default))
    try:
        n = int(raw)
    except ValueError:
        n = default
    if minimum is not None:
        n = max(minimum, n)
    return n


def csv_list(value: str) -> list[str]:
    return [s.strip().lower() for s in (value or "").split(",") if s.strip()]


def try_max_runtime() -> None:
    try:
        import resource

        resource.setrlimit(resource.RLIMIT_CPU, (resource.RLIM_INFINITY, resource.RLIM_INFINITY))
    except Exception:
        pass


try_max_runtime()

DEFAULT_INGEST_URL = "https://irancrypto.market/api/ingest"


def resolve_ingest_url(raw: str | None = None) -> str:
    base = (raw.strip() if raw else DEFAULT_INGEST_URL).rstrip("/")
    if not re.search(r"/api/ingest(/|$)", base):
        base = f"{base.rstrip('/')}/api/ingest"
    return base.rstrip("/")


load_dotenv(SCRIPT_DIR / ".env")
load_dotenv(Path.cwd() / ".env")

USER_AGENT = env(
    "USER_AGENT",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
)
USER_AGENT_POSTMAN = "PostmanRuntime/7.26.10"

INGEST_URL = resolve_ingest_url(env("INGEST_URL") or None)
INGEST_SECRET = env("INGEST_SECRET", "")
INGEST_NODE = env("INGEST_NODE", "") or (socket.gethostname() or "py")
LOG_DIR = Path(env("LOG_DIR") or str(SCRIPT_DIR / "logs"))
LOG_RETENTION_DAYS = env_int("LOG_RETENTION_DAYS", 7, minimum=1)
HTTP_TIMEOUT_SEC = env_int("TIMEOUT", 10, minimum=1)
IGNORE_EXCHANGES = env("IGNORE_EXCHANGES", "")
EXCHANGES_ALLOW = env("EXCHANGES", "")
PROXY_URL = env("PROXY_URL", "")
PROXY_API_KEY = env("PROXY_API_KEY", "")
COINMARKETCAP_API_KEY = env("COINMARKETCAP_API_KEY", "")
COINAPI_KEY = env("COINAPI_KEY", "")
SSL_VERIFY_EXCHANGE = env_bool("SSL_VERIFY_EXCHANGE", False)
SSL_VERIFY_INGEST = env_bool("SSL_VERIFY_INGEST", True)
REQUEST_RETRY_COUNT = env_int("REQUEST_RETRY_COUNT", 0, minimum=0)
REQUEST_RETRY_BASE_MS = env_int("REQUEST_RETRY_BASE_MS", 300, minimum=50)


# =============================================================================
# LOGGING / CLI HELPERS
# =============================================================================


def log_info(msg: str) -> None:
    print(f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] {msg}", flush=True)


def log_error(msg: str) -> None:
    print(f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] ERROR: {msg}", file=sys.stderr, flush=True)


def default_run_id(dt: datetime | None = None) -> str:
    d = dt or datetime.now(timezone.utc)
    return d.strftime("%Y-%m-%dT%H")


def iso_now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"


class RunLogger:
    def __init__(self, log_dir: Path, node: str, run_id: str) -> None:
        day = run_id[:10]
        day_dir = log_dir / day
        day_dir.mkdir(parents=True, exist_ok=True)
        safe_node = re.sub(r"[^a-zA-Z0-9._-]+", "_", node) or "node"
        safe_run = re.sub(r"[^a-zA-Z0-9._-]+", "_", run_id) or "run"
        self.file_path = day_dir / f"{safe_node}-{safe_run}.jsonl"

    def event(self, event: str, data: dict[str, Any] | None = None) -> None:
        row: dict[str, Any] = {"ts": iso_now(), "event": event}
        if data:
            row.update(data)
        with self.file_path.open("a", encoding="utf-8") as fh:
            fh.write(json.dumps(row, ensure_ascii=False, separators=(",", ":")) + "\n")


def prune_logs(log_dir: Path, days: int) -> int:
    if not log_dir.is_dir():
        return 0
    cutoff = time.time() - days * 86400
    removed = 0
    for root, dirs, files in os.walk(log_dir, topdown=False):
        root_path = Path(root)
        for name in files:
            full = root_path / name
            try:
                if full.stat().st_mtime < cutoff:
                    full.unlink()
                    removed += 1
            except OSError:
                pass
        for name in dirs:
            d = root_path / name
            try:
                if not any(d.iterdir()):
                    d.rmdir()
            except OSError:
                pass
    return removed


# =============================================================================
# NUMBER HELPER
# =============================================================================


def num(input_val: Any, options: dict[str, Any] | None = None) -> float:
    """Port of runtime/js/num.js / scrape.php num() — returns float."""
    opts = options or {}
    add = opts.get("add")
    subtract = opts.get("subtract")
    multiply = opts.get("multiply")
    divide = opts.get("divide")
    round_up = bool(opts.get("roundUp", False))
    decimal_places = int(opts.get("decimalPlaces", 14))
    default_value = float(opts.get("defaultValue", 0))

    if input_val is None or input_val == "":
        return default_value
    if isinstance(input_val, str) and input_val.strip() == "":
        return default_value

    if isinstance(input_val, str):
        trimmed = input_val.strip()
        if re.match(r"^\(.+\)$", trimmed):
            trimmed = "-" + re.sub(r"^\(|\)$", "", trimmed)
        trimmed = trimmed.replace(",", "").replace("%", "")
        if not re.match(r"^[-+]?\d+(\.\d+)?$", trimmed):
            return default_value
        value = float(trimmed)
    elif isinstance(input_val, (int, float)):
        value = float(input_val)
        if not math.isfinite(value):
            return default_value
    else:
        return default_value

    if add is not None:
        value += float(add)
    if subtract is not None:
        value -= float(subtract)
    if multiply is not None:
        value *= float(multiply)
    if divide is not None:
        d = float(divide)
        if d == 0.0:
            return default_value
        value /= d

    if round_up:
        value = math.ceil(value)

    return float(round(value, decimal_places))


def coin_allowed(filter_coins: list[str], symbol: str) -> bool:
    if not filter_coins:
        return True
    upper = {c.upper() for c in filter_coins}
    return symbol.upper() in upper


def cmc_keys() -> list[str]:
    if not COINMARKETCAP_API_KEY:
        return []
    return [k.strip() for k in COINMARKETCAP_API_KEY.split(",") if k.strip()]


# =============================================================================
# HTTP
# =============================================================================


def _ssl_context(verify: bool) -> ssl.SSLContext:
    if verify:
        return ssl.create_default_context()
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    return ctx


def http_request(
    method: str,
    url: str,
    *,
    query: dict[str, Any] | None = None,
    headers: dict[str, str] | None = None,
    body: bytes | None = None,
    use_proxy: bool = False,
    user_agent: str | None = None,
    verify_ssl: bool = True,
    timeout: float | None = None,
    retry_403: bool = True,
) -> dict[str, Any]:
    if use_proxy:
        return http_via_proxy(method, url, query or {}, headers or {}, body)

    request_url = url
    if query:
        sep = "&" if "?" in url else "?"
        request_url = url + sep + urllib.parse.urlencode(query)

    ua = user_agent or USER_AGENT
    hdrs = {
        "Accept": "application/json",
        "User-Agent": ua,
    }
    if headers:
        hdrs.update(headers)

    to = timeout if timeout is not None else float(HTTP_TIMEOUT_SEC)
    max_attempts = 1 + REQUEST_RETRY_COUNT
    last_error: Exception | None = None

    for attempt in range(1, max_attempts + 1):
        req = urllib.request.Request(
            request_url, data=body, headers=hdrs, method=method.upper()
        )
        ctx = _ssl_context(verify_ssl)
        try:
            with urllib.request.urlopen(req, timeout=to, context=ctx) as resp:
                raw = resp.read().decode("utf-8", errors="replace")
                status = getattr(resp, "status", 200) or 200
        except urllib.error.HTTPError as e:
            raw = e.read().decode("utf-8", errors="replace") if e.fp else ""
            status = e.code
            if status == 403 and retry_403 and ua != USER_AGENT_POSTMAN:
                return http_request(
                    method,
                    url,
                    query=query,
                    headers=headers,
                    body=body,
                    use_proxy=False,
                    user_agent=USER_AGENT_POSTMAN,
                    verify_ssl=verify_ssl,
                    timeout=timeout,
                    retry_403=False,
                )
            last_error = RuntimeError(f"HTTP {status} for {request_url}: {raw[:300]}")
            if attempt < max_attempts:
                time.sleep((REQUEST_RETRY_BASE_MS * (2 ** (attempt - 1))) / 1000.0)
                continue
            raise last_error from e
        except Exception as e:
            last_error = RuntimeError(f"Request failed for {request_url}: {e}")
            if attempt < max_attempts:
                time.sleep((REQUEST_RETRY_BASE_MS * (2 ** (attempt - 1))) / 1000.0)
                continue
            raise last_error from e

        if status < 200 or status >= 300:
            last_error = RuntimeError(f"HTTP {status} for {request_url}: {raw[:300]}")
            if attempt < max_attempts:
                time.sleep((REQUEST_RETRY_BASE_MS * (2 ** (attempt - 1))) / 1000.0)
                continue
            raise last_error

        json_data: Any = None
        if raw:
            try:
                json_data = json.loads(raw)
            except json.JSONDecodeError as e:
                raise RuntimeError(f"Invalid JSON from {request_url}") from e

        return {"status": status, "body": raw, "json": json_data}

    raise last_error or RuntimeError(f"Request failed for {request_url}")


def http_via_proxy(
    method: str,
    url: str,
    query: dict[str, Any],
    headers: dict[str, str],
    body: bytes | None,
) -> dict[str, Any]:
    if not PROXY_URL or not PROXY_API_KEY:
        raise RuntimeError("PROXY_URL / PROXY_API_KEY required for proxy request")

    body_obj: Any = {}
    if body:
        try:
            body_obj = json.loads(body.decode("utf-8"))
        except (json.JSONDecodeError, UnicodeDecodeError):
            body_obj = {}

    payload = json.dumps(
        {
            "url": url,
            "method": method.upper(),
            "params": query,
            "body": body_obj,
            "headers": {
                "Accept": "application/json",
                "User-Agent": USER_AGENT,
                **headers,
            },
            "timeout": HTTP_TIMEOUT_SEC * 1000,
        }
    ).encode("utf-8")

    result = http_request(
        "POST",
        PROXY_URL,
        headers={
            "Content-Type": "application/json",
            "Accept": "application/json",
            "x-api-key": PROXY_API_KEY,
        },
        body=payload,
        verify_ssl=SSL_VERIFY_EXCHANGE,
        timeout=float(max(HTTP_TIMEOUT_SEC, 60)),
        retry_403=False,
    )

    data = result["json"]
    if isinstance(data, dict):
        data = data.get("data", data.get("body", data))
    if isinstance(data, str):
        try:
            data = json.loads(data)
        except json.JSONDecodeError:
            pass

    return {
        "status": result["status"],
        "body": data if isinstance(data, str) else json.dumps(data),
        "json": data,
    }


def http_get_json(
    url: str,
    query: dict[str, Any] | None = None,
    headers: dict[str, str] | None = None,
    use_proxy: bool = False,
) -> Any:
    return http_request(
        "GET",
        url,
        query=query,
        headers=headers,
        use_proxy=use_proxy,
        verify_ssl=SSL_VERIFY_EXCHANGE,
    )["json"]


def ingest_request(method: str, url_path: str, body: dict[str, Any] | None = None) -> Any:
    if not INGEST_SECRET:
        raise RuntimeError("INGEST_SECRET is required")
    if not url_path or url_path == "/":
        url = INGEST_URL
    else:
        url = f"{INGEST_URL}{url_path if url_path.startswith('/') else '/' + url_path}"
    headers = {
        "Accept": "application/json",
        "Authorization": f"Bearer {INGEST_SECRET}",
        "User-Agent": "irancrypto-tracker-py/1.0",
    }
    payload: bytes | None = None
    if body is not None:
        headers["Content-Type"] = "application/json"
        payload = json.dumps(body, ensure_ascii=False).encode("utf-8")

    result = http_request(
        method,
        url,
        headers=headers,
        body=payload,
        verify_ssl=SSL_VERIFY_INGEST,
        timeout=float(max(HTTP_TIMEOUT_SEC, 60)),
        retry_403=False,
    )
    return result["json"] if result["json"] is not None else {}

