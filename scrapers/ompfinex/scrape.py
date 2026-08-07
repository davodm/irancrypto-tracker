def parse_ompfinex(data: Any, coins: list[str]) -> list[dict[str, Any]]:
    if not isinstance(data, dict):
        raise RuntimeError("Ompfinex: empty response")
    list_data = data.get("data", []) if isinstance(data.get("data"), list) else []
    if not list_data:
        raise RuntimeError("Ompfinex: empty data list")
    out: list[dict[str, Any]] = []

    for item in list_data:
        if not isinstance(item, dict):
            continue
        quote = str(item.get("quote_currency", {}).get("id", "")).upper()
        if quote not in ("IRR", "IRT"):
            continue
        if "last_price" not in item or item["last_price"] is None:
            continue
        symbol = str(item.get("base_currency", {}).get("id", "")).upper()
        if not symbol or not coin_allowed(coins, symbol):
            continue

        price = num(item.get("last_price", 0), {"multiply": 10, "decimalPlaces": 8})
        volume_1d = num(item.get("last_volume", 0), {"multiply": 10, "roundUp": True})
        change_1d = num(item.get("day_change_percent", 0), {"decimalPlaces": 2})

        out.append({
            "currency": "IRR",
            "symbol": symbol,
            "price": price,
            "volume_1d": volume_1d,
            "coin_volume_1d": 0,
            "change_1d": change_1d,
            "source": "ompfinex",
        })

    return out


def job_ompfinex() -> dict[str, Any]:
    return {"url": "https://api.ompfinex.com/v1/market"}


def register_ompfinex() -> dict[str, Any]:
    return {
        "coin_use": "all",
        "job": job_ompfinex,
        "parse": parse_ompfinex,
    }
