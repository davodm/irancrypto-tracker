def parse_coinapi(data: Any, coins: list[str]) -> list[dict[str, Any]]:
    if not isinstance(data, list) or not data:
        raise RuntimeError("CoinAPI: empty")
    out: list[dict[str, Any]] = []
    for item in data:
        if not isinstance(item, dict):
            continue
        if int(item.get("type_is_crypto") or 0) != 1:
            continue
        symbol = str(item.get("asset_id") or "").upper()
        if not symbol or not coin_allowed(coins, symbol):
            continue
        out.append(
            {
                "currency": "USD",
                "symbol": symbol,
                "price": num(item.get("price_usd", 0), {"decimalPlaces": 8}),
                "volume_1d": num(item.get("volume_1day_usd", 0), {"roundUp": True}),
                "source": "coinapi",
            }
        )
    return out


def skip_coinapi() -> str | None:
    return "COINAPI_KEY empty" if not COINAPI_KEY else None


def job_coinapi() -> dict[str, Any]:
    return {
        "url": "https://rest.coinapi.io/v1/assets",
        "headers": {"X-CoinAPI-Key": COINAPI_KEY},
    }


def register_coinapi() -> dict[str, Any]:
    return {
        "coin_use": "all",
        "skip": skip_coinapi,
        "job": job_coinapi,
        "parse": parse_coinapi,
    }
