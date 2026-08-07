def parse_huluex(data: Any, coins: list[str]) -> list[dict[str, Any]]:
    lst = data.get("data") if isinstance(data, dict) and "data" in data else data
    if not isinstance(lst, list) or not lst:
        raise RuntimeError("Huluex: empty")
    out: list[dict[str, Any]] = []
    for row in lst:
        if not isinstance(row, dict):
            continue
        if "sellPrice" not in row and "buyPrice" not in row:
            continue
        symbol = str(row.get("symbol") or "").upper()
        if not symbol or not coin_allowed(coins, symbol):
            continue
        price = num(row.get("sellPrice") or row.get("buyPrice") or 0, {"decimalPlaces": 8, "multiply": 10})
        vol_raw = row.get("valume", row.get("volume", 0))
        out.append(
            {
                "currency": "IRR",
                "symbol": symbol,
                "price": price,
                "volume_1d": num(vol_raw, {"multiply": 10, "roundUp": True}),
                "coin_volume_1d": num(vol_raw, {"divide": price}) if price > 0 else 0.0,
                "change_1d": num(row.get("changePrice", 0), {"decimalPlaces": 2}),
                "source": "huluex",
            }
        )
    return out


def job_huluex() -> dict[str, Any]:
    return {
        "url": "https://api.huluex.com/api/market/getCoinsPriceV3",
        "query": {"withGate": "true", "version": 4},
    }


def register_huluex() -> dict[str, Any]:
    return {
        "coin_use": "all",
        "job": job_huluex,
        "parse": parse_huluex,
    }
