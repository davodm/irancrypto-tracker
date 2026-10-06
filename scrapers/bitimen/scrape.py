def parse_bitimen(data: Any, coins: list[str]) -> list[dict[str, Any]]:
    if not isinstance(data, dict) or not data:
        raise RuntimeError("Bitimen: empty response")
    out: list[dict[str, Any]] = []
    for key, item in data.items():
        if not isinstance(item, dict):
            continue
        symbol = str(item.get("base_asset_ticker", "")).upper()
        if not symbol or not coin_allowed(coins, symbol):
            continue
        raw_price = item.get("last_price") or item.get("best_bid_raw") or 0
        price = num(raw_price, {"multiply": 10, "decimalPlaces": 8})
        raw_vol = str(item.get("volume", "0") or "0").replace(",", "")
        volume_1d = num(raw_vol, {"multiply": 10, "roundUp": True})
        coin_volume_1d = num(volume_1d, {"divide": price, "decimalPlaces": 4}) if price > 0 else 0
        change_1d = num(item.get("change_display") or item.get("change") or 0, {"decimalPlaces": 2})

        out.append({
            "currency": "IRR",
            "symbol": symbol,
            "price": price,
            "volume_1d": volume_1d,
            "coin_volume_1d": coin_volume_1d,
            "change_1d": change_1d,
            "source": "bitimen",
        })

    return out


def job_bitimen() -> dict[str, Any]:
    return {
        "url": "https://api2.bitimen.com/api/market/stats",
        "query": {"quote_asset": "IRT"},
    }


def register_bitimen() -> dict[str, Any]:
    return {
        "coin_use": "all",
        "job": job_bitimen,
        "parse": parse_bitimen,
    }
