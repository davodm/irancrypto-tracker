def parse_saraf(data: Any, coins: list[str]) -> list[dict[str, Any]]:
    items = ((data.get("price") or {}).get("Items")) if isinstance(data, dict) else None
    if not isinstance(items, (list, dict)):
        raise RuntimeError("Saraf: empty")
    rows_iter = items.values() if isinstance(items, dict) else items
    out: list[dict[str, Any]] = []
    for item in rows_iter:
        if not isinstance(item, dict):
            continue
        if str(item.get("assetType") or "").upper() != "CRYPTO" or not item.get("p"):
            continue
        symbol = str(item.get("s") or "").upper()
        if not symbol or not coin_allowed(coins, symbol):
            continue
        price_irt = num(item["p"])
        out.append(
            {
                "currency": "IRR",
                "symbol": symbol,
                "price": num(item["p"], {"decimalPlaces": 8, "multiply": 10}),
                "volume_1d": num(item.get("mc", 0), {"roundUp": True, "multiply": 10}),
                "coin_volume_1d": (
                    num(item.get("mc", 0), {"divide": price_irt}) if price_irt > 0 else 0.0
                ),
                "change_1d": num(item.get("c", 0), {"decimalPlaces": 2}),
                "source": "saraf",
            }
        )
    return out


def job_saraf() -> dict[str, Any]:
    return {"url": "https://api.saraf.app/v3/prices/crypto"}


def register_saraf() -> dict[str, Any]:
    return {
        "coin_use": "all",
        "job": job_saraf,
        "parse": parse_saraf,
    }
