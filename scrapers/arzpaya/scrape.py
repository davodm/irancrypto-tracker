def scrape_arzpaya(coins: list[str]) -> list[dict[str, Any]]:
    popular_coins = ["BTC", "ETH", "USDT", "LTC", "BCH", "TRX", "DOGE", "LINK", "XRP", "SOL", "ADA"]
    target_coins = coins if coins else popular_coins
    out: list[dict[str, Any]] = []

    for coin in target_coins:
        if coin.upper() in ("IRT", "IRR"):
            continue
        try:
            url = f"https://na1.arzpaya.com/orderbook/buy/irt/{coin.lower()}"
            res = http_get_json(url)
            if isinstance(res, dict) and isinstance(res.get("Data"), list) and res["Data"]:
                top_bid = res["Data"][0]
                price = num(top_bid.get("p", top_bid.get("P")), {"multiply": 10, "decimalPlaces": 8})
                if price > 0:
                    out.append({
                        "currency": "IRR",
                        "symbol": coin.upper(),
                        "price": price,
                        "volume_1d": 0,
                        "coin_volume_1d": 0,
                        "change_1d": 0,
                        "source": "arzpaya",
                    })
        except Exception:
            pass

    return out


def register_arzpaya() -> dict[str, Any]:
    return {
        "coin_use": "all",
        "scrape": scrape_arzpaya,
    }
