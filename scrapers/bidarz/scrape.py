def scrape_bidarz(coins: list[str]) -> list[dict[str, Any]]:
    popular_coins = ["BTC", "ETH", "USDT", "LTC", "BCH", "TRX", "DOGE", "LINK", "XRP", "SOL", "ADA"]
    target_coins = coins if coins else popular_coins
    out: list[dict[str, Any]] = []

    for coin in target_coins:
        if coin.upper() in ("IRT", "IRR"):
            continue
        try:
            url = f"https://bidarz.ir/price/{coin.lower()}"
            res = http_request("GET", url, timeout=5)
            html = res.get("body", "")
            match = re.search(r'quoteId:"IRR"[^}]*?last:"([0-9.]+)"', html)
            if match:
                price = num(match.group(1), {"decimalPlaces": 8})
                if price > 0:
                    out.append({
                        "currency": "IRR",
                        "symbol": coin.upper(),
                        "price": price,
                        "volume_1d": 0,
                        "coin_volume_1d": 0,
                        "change_1d": 0,
                        "source": "bidarz",
                    })
        except Exception:
            pass

    return out


def register_bidarz() -> dict[str, Any]:
    return {
        "coin_use": "all",
        "scrape": scrape_bidarz,
    }
