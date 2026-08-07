def parse_bitpin_list(lst: list, coins: list[str]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for row in lst:
        if not isinstance(row, dict):
            continue
        c2 = row.get("currency2") or {}
        c1 = row.get("currency1") or {}
        ob = row.get("order_book_info") or {}
        if c2.get("code") != "IRT":
            continue
        if c1.get("forTest") or not ob.get("price"):
            continue
        symbol = str(c1.get("code") or "").upper()
        if not symbol or not coin_allowed(coins, symbol):
            continue
        created = (row.get("internal_price_info") or {}).get("created_at")
        ts = int(num(created, {"roundUp": True})) if created else int(time.time())
        out.append(
            {
                "currency": "IRR",
                "symbol": symbol,
                "price": num(ob["price"], {"decimalPlaces": 8, "multiply": 10}),
                "volume_1d": num(ob.get("value", 0), {"multiply": 10, "roundUp": True}),
                "coin_volume_1d": num(ob.get("amount", 0)),
                "change_1d": num(ob.get("change", 0), {"decimalPlaces": 2}),
                "source": "bitpin",
                "last_update": {"date": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(ts)), "timestamp": ts},
            }
        )
    return out


def scrape_bitpin(coins: list[str]) -> list[dict[str, Any]]:
    """Follow Django-style `next` pagination (and page=N fallback)."""
    all_rows: list[Any] = []
    next_url: str | None = None
    page = 1
    max_pages = 50

    for _ in range(max_pages):
        if next_url:
            result = http_get_json(next_url)
        else:
            query = {"page": page} if page > 1 else None
            result = http_get_json(
                "https://api.bitpin.ir/v1/mkt/markets/",
                query=query,
            )
        if not isinstance(result, dict) or not isinstance(result.get("results"), list):
            raise RuntimeError("Bitpin: invalid response")
        rows = result["results"]
        if not rows and not all_rows:
            raise RuntimeError("Bitpin: empty")
        all_rows.extend(rows)

        nxt = result.get("next")
        if isinstance(nxt, str) and nxt:
            next_url = nxt
            continue

        count = int(result.get("count") or 0)
        if count > 0 and len(all_rows) < count and len(rows) > 0:
            next_url = None
            page += 1
            continue
        break

    if not all_rows:
        raise RuntimeError("Bitpin: empty")
    return parse_bitpin_list(all_rows, coins)


def register_bitpin() -> dict[str, Any]:
    return {
        "coin_use": "all",
        "scrape": scrape_bitpin,
    }
