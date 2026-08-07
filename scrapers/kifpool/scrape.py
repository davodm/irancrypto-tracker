def parse_kifpool_list(lst: list[Any], coins: list[str]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for row in lst:
        if not isinstance(row, dict):
            continue
        if "priceSellIRT" not in row and "priceBuyIRT" not in row:
            continue
        symbol = str(row.get("symbol") or "").upper()
        if not symbol or not coin_allowed(coins, symbol):
            continue
        price_irt = float(row.get("priceSellIRT") or row.get("priceBuyIRT") or 0)
        out.append(
            {
                "currency": "IRR",
                "symbol": symbol,
                "price": num(price_irt, {"decimalPlaces": 8, "multiply": 10}),
                "volume_1d": num(row.get("volume", 0), {"roundUp": True, "multiply": 10}),
                "coin_volume_1d": (
                    num(row.get("volume", 0), {"divide": price_irt}) if price_irt > 0 else 0.0
                ),
                "change_1d": num(row.get("priceChangePercent", 0), {"decimalPlaces": 2}),
                "source": "kifpool",
            }
        )
    return out


def scrape_kifpool(coins: list[str]) -> list[dict[str, Any]]:
    offset = 0
    limit = 200
    all_rows: list[Any] = []
    while True:
        response = http_get_json(
            "https://api.kifpool.app/api/spot/price/paginated",
            {"offset": offset, "limit": limit},
        )
        if not isinstance(response, dict) or not isinstance(response.get("data"), list) or not response["data"]:
            break
        all_rows.extend(response["data"])
        total = int((response.get("meta") or {}).get("total") or 0)
        offset += limit
        if len(response["data"]) < limit or (total > 0 and offset >= total):
            break
    if not all_rows:
        raise RuntimeError("KifPool: empty")
    return parse_kifpool_list(all_rows, coins)


def register_kifpool() -> dict[str, Any]:
    return {
        "coin_use": "all",
        "scrape": scrape_kifpool,
    }
