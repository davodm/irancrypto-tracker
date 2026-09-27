def parse_bidarz_page(html: str, coin: str) -> dict[str, Any] | None:
    """Parse the IRT ticker embedded in a Bidarz price page (`quoteId:"IRR"` is labelled Toman,
    and its prices and volume are in Toman).
    Returns None when the market is missing, idle for 24h, or too imprecise.
    """
    # Bidarz rounds Toman prices to whole units; below this the rounding error exceeds 1%.
    min_price_toman = 100

    ticker_match = re.search(r'\{[^{}]*quoteId:"IRR"[^{}]*\}', html)
    if not ticker_match:
        return None
    ticker = ticker_match.group(0)

    def field(key: str) -> float:
        m = re.search(r"[{,]" + key + r':"?(-?[0-9]*\.?[0-9]+)', ticker)
        return float(m.group(1)) if m else 0.0

    price_toman = field("last")
    # A zero 24h high means no trades, so `last` is stale.
    if price_toman < min_price_toman or field("max24h") <= 0:
        return None

    volume_toman = field("volume24h")
    return {
        "currency": "IRR",
        "symbol": coin.upper(),
        "price": num(price_toman, {"multiply": 10, "decimalPlaces": 8}),
        "volume_1d": num(volume_toman, {"multiply": 10, "roundUp": True}),
        "coin_volume_1d": num(volume_toman, {"divide": price_toman}),
        "change_1d": num(field("changePercent24h"), {"decimalPlaces": 2}),
        "change_7d": num(field("changePercent7d"), {"decimalPlaces": 2}),
        "source": "bidarz",
    }


def scrape_bidarz(coins: list[str]) -> list[dict[str, Any]]:
    popular_coins = ["BTC", "ETH", "USDT", "LTC", "BCH", "TRX", "DOGE", "LINK", "XRP", "SOL", "ADA"]
    out: list[dict[str, Any]] = []

    for coin in coins or popular_coins:
        if coin.upper() in ("IRT", "IRR"):
            continue
        try:
            row = parse_bidarz_page(http_get_text(f"https://bidarz.ir/price/{coin.lower()}"), coin)
        except Exception:
            continue
        if row is not None:
            out.append(row)

    return out


def register_bidarz() -> dict[str, Any]:
    return {
        "coin_use": "all",
        "scrape": scrape_bidarz,
    }
