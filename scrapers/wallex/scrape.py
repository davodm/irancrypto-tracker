def parse_wallex(data: Any, coins: list[str]) -> list[dict[str, Any]]:
    if not isinstance(data, dict):
        raise RuntimeError("Wallex: invalid")
    symbols = (data.get("result") or {}).get("symbols") if isinstance(data.get("result"), dict) else None
    if symbols is None:
        symbols = data.get("symbols")
    if not isinstance(symbols, (list, dict)) or not symbols:
        raise RuntimeError("Wallex: empty")
    rows_iter = symbols.values() if isinstance(symbols, dict) else symbols
    out: list[dict[str, Any]] = []
    for row in rows_iter:
        if not isinstance(row, dict):
            continue
        if str(row.get("quoteAsset") or "").upper() != "TMN":
            continue
        stats = row.get("stats") or {}
        if not stats.get("lastPrice"):
            continue
        symbol = str(row.get("baseAsset") or "").upper()
        if not symbol or not coin_allowed(coins, symbol):
            continue
        out.append(
            {
                "currency": "IRR",
                "symbol": symbol,
                "price": num(stats["lastPrice"], {"multiply": 10, "decimalPlaces": 8}),
                "volume_1d": num(stats.get("24h_quoteVolume", 0), {"roundUp": True, "multiply": 10}),
                "coin_volume_1d": num(stats.get("24h_volume", 0)),
                "change_1d": num(stats.get("24h_ch", 0), {"decimalPlaces": 2}),
                "change_7d": num(stats.get("7d_ch", 0), {"decimalPlaces": 2}),
                "source": "wallex",
            }
        )
    return out


def job_wallex() -> dict[str, Any]:
    return {"url": "https://api.wallex.ir/v1/markets"}


def register_wallex() -> dict[str, Any]:
    return {
        "coin_use": "all",
        "job": job_wallex,
        "parse": parse_wallex,
    }
