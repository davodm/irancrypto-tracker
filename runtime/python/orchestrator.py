
# Scrape orchestration: job-mode scrapers run in a thread pool; custom scrape_*
# handlers (pagination) run sequentially afterward.

def fetch_job(job: dict[str, Any]) -> Any:
    return http_request(
        "GET",
        job["url"],
        query=job.get("query"),
        headers=job.get("headers"),
        use_proxy=bool(job.get("use_proxy")),
        verify_ssl=SSL_VERIFY_EXCHANGE,
    )["json"]


def scrape_exchanges(
    exchanges: list[dict[str, Any]],
    coins: list[str],
    logger: RunLogger | None = None,
) -> list[dict[str, Any]]:
    registry = scraper_registry()
    ignored = csv_list(IGNORE_EXCHANGES)
    jobs: dict[str, dict[str, Any]] = {}
    meta: dict[str, dict[str, Any]] = {}
    collected: list[dict[str, Any]] = []

    for ex in exchanges:
        slug = str(ex.get("slug") or "").lower()
        if not slug:
            continue
        if slug in ignored:
            log_info(f"Ignoring exchange: {slug}")
            continue
        if slug not in registry:
            log_info(f"No Python scraper for: {slug}")
            continue
        cfg = registry[slug]
        skip_fn = cfg.get("skip")
        if skip_fn:
            reason = skip_fn()
            if reason:
                log_info(f"Skipping {slug}: {reason}")
                continue
        filter_coins = (ex.get("support") or []) if cfg.get("coin_use") == "own" else coins
        filter_coins = [str(c).upper() for c in filter_coins]

        if "scrape" in cfg:
            meta[slug] = {"mode": "custom", "filter": filter_coins, "cfg": cfg}
            continue

        jobs[slug] = cfg["job"]()
        meta[slug] = {"mode": "job", "filter": filter_coins, "cfg": cfg}

    # Parallel HTTP for job-mode scrapers
    if jobs:
        log_info(f"Fetching {len(jobs)} exchange endpoint(s) in parallel…")
        t0 = time.monotonic()
        responses: dict[str, dict[str, Any]] = {}

        def _fetch(slug: str, job: dict[str, Any]) -> tuple[str, dict[str, Any]]:
            try:
                data = fetch_job(job)
                return slug, {"ok": True, "json": data}
            except Exception as e:
                return slug, {"ok": False, "error": str(e)}

        with ThreadPoolExecutor(max_workers=min(16, max(1, len(jobs)))) as pool:
            futs = [pool.submit(_fetch, s, j) for s, j in jobs.items()]
            for fut in as_completed(futs):
                slug, resp = fut.result()
                responses[slug] = resp
        log_info(f"Parallel fetch done in {time.monotonic() - t0:.1f}s")

        for slug, m in meta.items():
            if m["mode"] != "job":
                continue
            resp = responses.get(slug) or {"ok": False, "error": "missing response"}
            if not resp.get("ok"):
                msg = resp.get("error") or "failed"
                log_error(f"{slug}: {msg}")
                if logger:
                    logger.event("scrape_err", {"source": slug, "message": str(msg)})
                continue
            try:
                t1 = time.monotonic()
                rows = m["cfg"]["parse"](resp["json"], m["filter"])
                collected.extend(rows)
                log_info(f"{slug}: {len(rows)} rows in {time.monotonic() - t1:.1f}s")
                if logger:
                    logger.event("scrape_ok", {"source": slug, "rows": len(rows)})
            except Exception as e:
                log_error(f"{slug} parse: {e}")
                if logger:
                    logger.event("scrape_err", {"source": slug, "message": str(e)})

    # Custom scrapers (pagination etc.) sequentially
    for slug, m in meta.items():
        if m["mode"] != "custom":
            continue
        try:
            t1 = time.monotonic()
            log_info(f"Processing {slug} exchange started")
            rows = m["cfg"]["scrape"](m["filter"])
            collected.extend(rows)
            log_info(f"{slug}: {len(rows)} rows in {time.monotonic() - t1:.1f}s")
            if logger:
                logger.event("scrape_ok", {"source": slug, "rows": len(rows)})
        except Exception as e:
            log_error(f"{slug}: {e}")
            if logger:
                logger.event("scrape_err", {"source": slug, "message": str(e)})

    return collected


def filter_rows(raw: list[dict[str, Any]], coins: list[str]) -> list[dict[str, Any]]:
    coin_set = {str(c).upper() for c in coins}
    out: list[dict[str, Any]] = []
    for d in raw:
        if not d.get("price") or float(d["price"]) <= 0:
            continue
        if not d.get("volume_1d") or float(d["volume_1d"]) <= 0:
            continue
        if not d.get("source"):
            continue
        sym = str(d.get("symbol") or "").upper()
        if not sym or sym not in coin_set:
            continue
        row: dict[str, Any] = {
            "symbol": sym,
            "currency": str(d.get("currency") or "IRR").upper(),
            "price": float(d["price"]),
            "volume_1d": float(d["volume_1d"]),
            "source": str(d["source"]).lower(),
        }
        for opt in (
            "coin_volume_1d",
            "change_1d",
            "change_7d",
            "market_cap",
            "supply",
            "max_supply",
        ):
            if d.get(opt) is not None:
                row[opt] = float(d[opt])
        out.append(row)
    return out


def select_exchanges(
    exchanges: list[dict[str, Any]],
    exchange_flag: str | None,
) -> list[dict[str, Any]]:
    ignored = csv_list(IGNORE_EXCHANGES)
    allow = csv_list(EXCHANGES_ALLOW)
    if exchange_flag:
        allow = [exchange_flag.lower()]
    out: list[dict[str, Any]] = []
    for ex in exchanges:
        slug = str(ex.get("slug") or "").lower()
        if not slug:
            continue
        if slug in ignored:
            continue
        if allow and slug not in allow:
            continue
        out.append(ex)
    return out


# =============================================================================
# CLI / MAIN
# =============================================================================


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="track.py",
        description="IranCrypto tracker (Python) — API-only single-file worker",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=(
            "Usage examples:\n"
            "  python3 track.py --all [--finalize]\n"
            "  python3 track.py --exchange=nobitex\n"
            "  python3 track.py --finalize-only [--run-id=YYYY-MM-DDTHH]\n"
            "  python3 track.py --from-json=rows.json\n"
            "  python3 track.py --prune-logs\n\n"
            "Env:\n"
            "  INGEST_SECRET (required) INGEST_URL INGEST_NODE LOG_DIR LOG_RETENTION_DAYS\n"
            f"  INGEST_URL defaults to {DEFAULT_INGEST_URL}\n"
            "  TIMEOUT EXCHANGES IGNORE_EXCHANGES PROXY_URL PROXY_API_KEY\n"
            "  FINALIZE_WAIT_SEC FINALIZE_POLL_SEC\n"
            "  Only one node should --finalize (Lambda).\n"
            "  COINMARKETCAP_API_KEY COINAPI_KEY SSL_VERIFY_EXCHANGE SSL_VERIFY_INGEST\n\n"
            "Make executable: chmod +x track.py"
        ),
    )
    parser.add_argument("--all", action="store_true", help="Scrape all configured exchanges")
    parser.add_argument("--exchange", metavar="SLUG", help="Scrape a single exchange slug")
    parser.add_argument("--finalize", action="store_true", help="Call finalize after ingest")
    parser.add_argument(
        "--finalize-only",
        action="store_true",
        help="Only call finalize for --run-id (default: current UTC hour)",
    )
    parser.add_argument("--run-id", metavar="ID", help="Run id (default: UTC YYYY-MM-DDTHH)")
    parser.add_argument("--dry-run", action="store_true", help="Scrape/log but skip ingest/finalize")
    parser.add_argument(
        "--from-json",
        metavar="FILE",
        help="Ingest rows from a JSON file instead of scraping",
    )
    parser.add_argument(
        "--prune-logs",
        action="store_true",
        help="Prune old JSONL logs (also runs after normal jobs)",
    )
    return parser


def parse_cli(argv: list[str]) -> argparse.Namespace:
    parser = build_parser()
    # Accept --exchange=SLUG style used by JS/PHP workers
    known, unknown = parser.parse_known_args(argv)
    for arg in unknown:
        if arg.startswith("--exchange="):
            known.exchange = arg.split("=", 1)[1].lower()
        elif arg.startswith("--run-id="):
            known.run_id = arg.split("=", 1)[1]
        elif arg.startswith("--from-json="):
            known.from_json = arg.split("=", 1)[1]
        else:
            parser.error(f"Unknown argument: {arg}")
    if known.exchange:
        known.exchange = known.exchange.lower()
    return known


def main(argv: list[str] | None = None) -> int:
    args = parse_cli(argv if argv is not None else sys.argv[1:])

    if (
        args.prune_logs
        and not args.all
        and not args.exchange
        and not args.finalize_only
        and not args.from_json
    ):
        n = prune_logs(LOG_DIR, LOG_RETENTION_DAYS)
        log_info(f"Pruned {n} log file(s) older than {LOG_RETENTION_DAYS} days")
        return 0

    if (
        not args.all
        and not args.exchange
        and not args.from_json
        and not args.finalize_only
    ):
        log_error("Specify --all, --exchange=SLUG, --from-json=, or --finalize-only")
        build_parser().print_help()
        return 1

    run_id = args.run_id or default_run_id()
    logger = RunLogger(LOG_DIR, INGEST_NODE, run_id)
    log_info(f"IranCrypto track.py starting run_id={run_id}")
    log_info(f"Logs: {logger.file_path}")
    logger.event(
        "run_start",
        {"run_id": run_id, "node": INGEST_NODE, "dry_run": bool(args.dry_run)},
    )

    if args.finalize_only:
        if args.dry_run:
            log_info(f"Dry-run: would finalize {run_id}")
            logger.event("run_end", {"ok": True, "dry_run": True})
            return 0
        try:
            finalize_when_ready(run_id, logger)
        except Exception as e:
            log_error(str(e))
            logger.event("finalize_err", {"message": str(e)})
            logger.event("run_end", {"ok": False})
            return 1
        prune_logs(LOG_DIR, LOG_RETENTION_DAYS)
        logger.event("run_end", {"ok": True})
        return 0

    try:
        config = ingest_request("GET", "/config")
    except Exception as e:
        log_error(str(e))
        logger.event("run_end", {"ok": False, "error": str(e)})
        return 1

    if not isinstance(config, dict):
        log_error("Invalid config response")
        return 1

    logger.event(
        "config_ok",
        {
            "exchanges": len(config.get("exchanges") or []),
            "coins": len(config.get("coins") or []),
        },
    )
    if not args.run_id and config.get("run_id_default"):
        run_id = str(config["run_id_default"])
        logger = RunLogger(LOG_DIR, INGEST_NODE, run_id)

    exchanges_raw = []
    for ex in config.get("exchanges") or []:
        if not isinstance(ex, dict) or not ex.get("slug"):
            continue
        item: dict[str, Any] = {"slug": str(ex["slug"])}
        if isinstance(ex.get("support"), list):
            item["support"] = [str(s) for s in ex["support"]]
        exchanges_raw.append(item)

    coins = [str(c).upper() for c in (config.get("coins") or [])]
    exchanges = select_exchanges(exchanges_raw, args.exchange)
    logger.event(
        "run_start",
        {
            "run_id": run_id,
            "node": INGEST_NODE,
            "exchanges": [e["slug"] for e in exchanges],
        },
    )

    by_source: dict[str, list[dict[str, Any]]] = {}

    if args.from_json:
        path = Path(args.from_json)
        try:
            decoded = json.loads(path.read_text(encoding="utf-8"))
        except Exception as e:
            log_error(f"Cannot read --from-json: {e}")
            return 1
        rows = decoded.get("rows") if isinstance(decoded, dict) and "rows" in decoded else decoded
        if not isinstance(rows, list):
            log_error("Invalid JSON in --from-json")
            return 1
        for row in rows:
            if not isinstance(row, dict) or not row.get("source"):
                continue
            src = str(row["source"]).lower()
            by_source.setdefault(src, []).append(row)
    else:
        if not exchanges or not coins:
            log_error("No exchanges or coins from config")
            return 1
        scraped = scrape_exchanges(exchanges, coins, logger)
        filtered = filter_rows(scraped, coins)
        log_info(
            f"Discovered {len(filtered)} filtered rows from "
            f"{len({r['source'] for r in filtered})} sources"
        )
        for row in filtered:
            by_source.setdefault(row["source"], []).append(row)

    collected_at = iso_now()
    ok = True

    for source, rows in by_source.items():
        payload = {
            "run_id": run_id,
            "mode": "partial",
            "source": source,
            "collected_at": collected_at,
            "node": INGEST_NODE,
            "rows": rows,
            "finalize": False,
        }
        if args.dry_run:
            log_info(f"Dry-run: would ingest {source} rows={len(rows)}")
            logger.event(
                "ingest_skip",
                {"source": source, "reason": "dry_run", "rows": len(rows)},
            )
            continue
        try:
            t0 = time.monotonic()
            res = ingest_request("POST", "", payload)
            if not isinstance(res, dict):
                res = {}
            logger.event(
                "ingest_ok",
                {
                    "source": source,
                    "rows": len(rows),
                    "upserted": res.get("upserted"),
                    "skipped": res.get("skipped"),
                    "http": 200,
                    "ms": int((time.monotonic() - t0) * 1000),
                },
            )
            log_info(f"Ingested {source}: rows={len(rows)}")
        except Exception as e:
            ok = False
            log_error(str(e))
            logger.event("ingest_err", {"source": source, "message": str(e)})

    if args.finalize and not args.dry_run:
        try:
            finalize_when_ready(run_id, logger)
        except Exception as e:
            ok = False
            log_error(str(e))
            logger.event("finalize_err", {"message": str(e)})

    pruned = prune_logs(LOG_DIR, LOG_RETENTION_DAYS)
    if pruned:
        log_info(f"Pruned {pruned} old log file(s)")
    logger.event("run_end", {"ok": ok})
    log_info(
        f"Done in {time.monotonic() - SCRIPT_STARTED_AT:.1f}s ok={'true' if ok else 'false'}"
    )
    return 0 if ok else 1


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except SystemExit:
        raise
    except Exception as e:
        log_error(str(e))
        raise SystemExit(1) from e
