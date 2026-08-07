def parse_ramzinex(data: Any, coins: list[str]) -> list[dict[str, Any]]:
    lst = data.get("data") if isinstance(data, dict) and "data" in data else data
    if not isinstance(lst, list) or not lst:
        raise RuntimeError("Ramzinex: empty")
    out: list[dict[str, Any]] = []
    for row in lst:
        if not isinstance(row, dict):
            continue
        quote = str(((row.get("quote_currency_symbol") or {}).get("en")) or "").upper()
        if quote != "IRR" or "sell" not in row:
            continue
        symbol = str(((row.get("base_currency_symbol") or {}).get("en")) or "").upper()
        if not symbol or not coin_allowed(coins, symbol):
            continue
        fin = ((row.get("financial") or {}).get("last24h")) or {}
        out.append(
            {
                "currency": "IRR",
                "symbol": symbol,
                "price": num(row["sell"], {"decimalPlaces": 8}),
                "volume_1d": num(fin.get("quote_volume", 0), {"roundUp": True}),
                "coin_volume_1d": num(fin.get("base_volume", 0)),
                "change_1d": num(fin.get("change_percent", 0), {"decimalPlaces": 2}),
                "source": "ramzinex",
            }
        )
    return out


def job_ramzinex() -> dict[str, Any]:
    return {
        "url": "https://publicapi.ramzinex.com/exchange/api/v1.0/exchange/pairs"
    }


def register_ramzinex() -> dict[str, Any]:
    return {
        "coin_use": "all",
        "job": job_ramzinex,
        "parse": parse_ramzinex,
    }
