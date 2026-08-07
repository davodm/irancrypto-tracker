def parse_ariomex_list(lst: list, coins: list[str]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for row in lst:
        if not isinstance(row, dict) or not row.get("last_price"):
            continue
        symbol = str(row.get("base") or "").upper()
        if not symbol or not coin_allowed(coins, symbol):
            continue
        coin_volume = num(row.get("volume", 0))
        price_irt = num(row.get("last_price"))
        volume_irt = coin_volume * price_irt
        out.append(
            {
                "currency": "IRR",
                "symbol": symbol,
                "price": num(row["last_price"], {"decimalPlaces": 8, "multiply": 10}),
                "volume_1d": num(volume_irt, {"multiply": 10, "roundUp": True}),
                "coin_volume_1d": coin_volume,
                "change_1d": num(row.get("change_percentage", 0), {"decimalPlaces": 2}),
                "source": "ariomex",
            }
        )
    return out


def scrape_ariomex(coins: list[str]) -> list[dict[str, Any]]:
    all_rows: list[Any] = []
    max_rows = 200
    max_pages = 20
    for page in range(1, max_pages + 1):
        response = http_get_json(
            "https://data.ariomex.com/exchange_data/markets_details",
            query={
                "maxRowsPerPage": max_rows,
                "page": page,
                "resolution": "1d",
                "quote": "irt",
            },
        )
        if not isinstance(response, dict) or response.get("status") != "true":
            raise RuntimeError("Ariomex: invalid status")
        lst = response.get("result")
        if not isinstance(lst, list) or not lst:
            break
        all_rows.extend(lst)
        if len(lst) < max_rows:
            break
    if not all_rows:
        raise RuntimeError("Ariomex: empty")
    return parse_ariomex_list(all_rows, coins)


def register_ariomex() -> dict[str, Any]:
    return {
        "coin_use": "all",
        "scrape": scrape_ariomex,
    }
