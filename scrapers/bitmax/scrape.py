def parse_bitmax(data: Any, coins: list[str]) -> list[dict[str, Any]]:
    msg = data.get("message") if isinstance(data, dict) and "message" in data else data
    if not isinstance(msg, dict) or not msg or (isinstance(data, dict) and data.get("error")):
        raise RuntimeError("BitMax: empty/error")
    usdt = 0.0
    if isinstance(msg.get("USDT"), dict) and msg["USDT"].get("price_in_irt"):
        usdt = num(msg["USDT"]["price_in_irt"], {"decimalPlaces": 8, "multiply": 10})
    out: list[dict[str, Any]] = []
    for symbol_key, row in msg.items():
        if not isinstance(row, dict) or not row.get("price_in_irt"):
            continue
        symbol = str(symbol_key).upper()
        if not coin_allowed(coins, symbol):
            continue
        out.append(
            {
                "currency": "IRR",
                "symbol": symbol,
                "price": num(row["price_in_irt"], {"decimalPlaces": 8, "multiply": 10}),
                # volume_24h is the global market volume (CoinMarketCap mirror), not BitMax's own trading
                "volume_1d": 0,
                "coin_volume_1d": 0,
                "change_1d": num(row.get("change", 0), {"decimalPlaces": 2}),
                "change_7d": num(row.get("change_7d", 0), {"decimalPlaces": 2}),
                "market_cap": num(row.get("market_cap", 0), {"multiply": usdt, "roundUp": True}),
                "source": "bitmax",
            }
        )
    return out


def job_bitmax() -> dict[str, Any]:
    return {"url": "https://api.bitmax.ir/watcher/price/alternative"}


def register_bitmax() -> dict[str, Any]:
    return {
        "coin_use": "all",
        "job": job_bitmax,
        "parse": parse_bitmax,
    }
