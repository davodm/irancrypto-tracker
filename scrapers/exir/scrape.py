def parse_exir(data: Any, coins: list[str]) -> list[dict[str, Any]]:
    if not isinstance(data, dict) or not data:
        raise RuntimeError("Exir: empty")
    out: list[dict[str, Any]] = []
    for key, row in data.items():
        if not isinstance(row, dict):
            continue
        parts = str(key).upper().split("-")
        symbol = parts[0] if parts else ""
        currency = parts[1] if len(parts) > 1 else ""
        if currency != "IRT" or not row.get("last"):
            continue
        if not symbol or not coin_allowed(coins, symbol):
            continue
        price = num(row.get("last") or row.get("close") or 0, {"multiply": 10, "decimalPlaces": 8})
        out.append(
            {
                "currency": "IRR",
                "symbol": symbol,
                "price": price,
                "volume_1d": num(row.get("volume", 0), {"multiply": price, "roundUp": True}),
                "coin_volume_1d": num(row.get("volume", 0)),
                "source": "exir",
            }
        )
    return out


def job_exir() -> dict[str, Any]:
    return {"url": "https://api.exir.io/v2/ticker/all"}


def register_exir() -> dict[str, Any]:
    return {
        "coin_use": "all",
        "job": job_exir,
        "parse": parse_exir,
    }
