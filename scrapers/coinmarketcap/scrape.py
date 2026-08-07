def parse_coinmarketcap(data: Any, coins: list[str]) -> list[dict[str, Any]]:
    if not isinstance(data, dict):
        raise RuntimeError("CMC: invalid")
    status = data.get("status") or {}
    if status.get("error_code") is not None and int(status.get("error_code") or 0) != 0:
        raise RuntimeError(f"CMC: {status.get('error_message') or 'invalid'}")
    lst = data.get("data") if isinstance(data.get("data"), list) else data
    if not isinstance(lst, list) or not lst:
        raise RuntimeError("CMC: empty")
    out: list[dict[str, Any]] = []
    for row in lst:
        if not isinstance(row, dict):
            continue
        quote_usd = ((row.get("quote") or {}).get("USD")) or None
        if not quote_usd:
            continue
        symbol = str(row.get("symbol") or "").upper()
        if not symbol or not coin_allowed(coins, symbol):
            continue
        price = num(quote_usd.get("price", 0), {"decimalPlaces": 8})
        item: dict[str, Any] = {
            "currency": "USD",
            "symbol": symbol,
            "price": price,
            "volume_1d": num(quote_usd.get("volume_24h", 0), {"roundUp": True}),
            "change_1d": num(quote_usd.get("percent_change_24h", 0), {"decimalPlaces": 2}),
            "change_7d": num(quote_usd.get("percent_change_7d", 0), {"decimalPlaces": 2}),
            "market_cap": num(quote_usd.get("market_cap", 0), {"roundUp": True}),
            "supply": num(row.get("circulating_supply", 0)),
            "max_supply": num(row.get("max_supply", 0)),
            "source": "coinmarketcap",
        }
        sym_quote = ((row.get("quote") or {}).get(symbol)) or {}
        if sym_quote.get("volume_24h") is not None:
            item["coin_volume_1d"] = num(sym_quote["volume_24h"])
        elif price > 0:
            item["coin_volume_1d"] = num(quote_usd.get("volume_24h", 0), {"divide": price})
        out.append(item)
    return out


def skip_coinmarketcap() -> str | None:
    return "COINMARKETCAP_API_KEY empty" if not cmc_keys() else None


def job_coinmarketcap() -> dict[str, Any]:
    keys = cmc_keys()
    key = random.choice(keys)
    return {
        "url": "https://pro-api.coinmarketcap.com/v1/cryptocurrency/listings/latest",
        "query": {
            "start": 1,
            "limit": 200,
            "aux": (
                "max_supply,circulating_supply,total_supply,market_cap_by_total_supply,"
                "volume_24h_reported,volume_7d,volume_7d_reported,volume_30d,"
                "volume_30d_reported,is_market_cap_included_in_calc"
            ),
        },
        "headers": {"X-CMC_PRO_API_KEY": key},
    }


def register_coinmarketcap() -> dict[str, Any]:
    return {
        "coin_use": "all",
        "skip": skip_coinmarketcap,
        "job": job_coinmarketcap,
        "parse": parse_coinmarketcap,
    }
