def parse_hitobit(data: Any, coins: list[str]) -> list[dict[str, Any]]:
    if not isinstance(data, list) or not data:
        raise RuntimeError("Hitobit: empty")
    out: list[dict[str, Any]] = []
    for row in data:
        if not isinstance(row, dict):
            continue
        if row.get("quoteCurrencySymbol") != "IRT" or not row.get("lastPrice"):
            continue
        symbol = str(row.get("baseCurrencySymbol") or "").upper()
        if not symbol or not coin_allowed(coins, symbol):
            continue
        out.append(
            {
                "currency": "IRR",
                "symbol": symbol,
                "price": num(row["lastPrice"], {"decimalPlaces": 8, "multiply": 10}),
                "volume_1d": num(row.get("quoteVolume", 0), {"multiply": 10, "roundUp": True}),
                "coin_volume_1d": num(row.get("baseVolume", 0)),
                "change_1d": num(row.get("priceChangePercent", 0), {"decimalPlaces": 2}),
                "source": "hitobit",
            }
        )
    return out


def job_hitobit() -> dict[str, Any]:
    return {
        "url": "https://hitobit.com/hapi/exchange/v1/public/alltickers/24hr"
    }


def register_hitobit() -> dict[str, Any]:
    return {
        "coin_use": "all",
        "job": job_hitobit,
        "parse": parse_hitobit,
    }
