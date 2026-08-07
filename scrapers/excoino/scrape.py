def parse_excoino(data: Any, coins: list[str]) -> list[dict[str, Any]]:
    if not isinstance(data, list) or not data:
        raise RuntimeError("Excoino: empty")
    out: list[dict[str, Any]] = []
    for row in data:
        if not isinstance(row, dict):
            continue
        split = str(row.get("symbol") or "").upper().split("/")
        if len(split) == 2 and split[1] != "IRR":
            continue
        if not row.get("trend") or not isinstance(row["trend"], list):
            continue
        raw_symbol = str(row.get("symbol") or "").split("/")[0]
        symbol = raw_symbol.upper()
        if not symbol or not coin_allowed(coins, symbol):
            continue
        out.append(
            {
                "currency": "IRR",
                "symbol": symbol,
                "price": num(row["trend"][0] if row["trend"] else 0, {"decimalPlaces": 8}),
                "volume_1d": num(row.get("twentyFourHourTurnover", 0), {"roundUp": True}),
                "coin_volume_1d": num(row.get("twentyFourHourVolume", 0)),
                "change_1d": num(row.get("chg", 0), {"decimalPlaces": 2}),
                "source": "excoino",
            }
        )
    return out


def job_excoino() -> dict[str, Any]:
    return {"url": "https://market-api.excoino.com/market/symbol-thumb-trend"}


def register_excoino() -> dict[str, Any]:
    return {
        "coin_use": "all",
        "job": job_excoino,
        "parse": parse_excoino,
    }
