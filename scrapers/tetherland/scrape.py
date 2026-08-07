def parse_tetherland(data: Any, coins: list[str]) -> list[dict[str, Any]]:
    if not isinstance(data, dict):
        raise RuntimeError("Tetherland: empty response")
    currencies = data.get("data", {}).get("currencies", {})
    if not isinstance(currencies, dict) or not currencies:
        raise RuntimeError("Tetherland: empty currencies")
    out: list[dict[str, Any]] = []

    for symbol, item in currencies.items():
        if not isinstance(item, dict):
            continue
        upper_symbol = str(symbol).upper()
        if not coin_allowed(coins, upper_symbol):
            continue

        raw_price = item.get("price") or item.get("buy_price") or 0
        price = num(raw_price, {"multiply": 10, "decimalPlaces": 8})
        change_1d = num(item.get("diff24d", 0), {"decimalPlaces": 2})

        out.append({
            "currency": "IRR",
            "symbol": upper_symbol,
            "price": price,
            "volume_1d": 0,
            "coin_volume_1d": 0,
            "change_1d": change_1d,
            "source": "tetherland",
        })

    return out


def job_tetherland() -> dict[str, Any]:
    return {"url": "https://api.tetherland.com/currencies"}


def register_tetherland() -> dict[str, Any]:
    return {
        "coin_use": "all",
        "job": job_tetherland,
        "parse": parse_tetherland,
    }
