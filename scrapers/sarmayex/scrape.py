def scrape_sarmayex(coins: list[str]) -> list[dict[str, Any]]:
    headers = {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"}
    res = http_request("GET", "https://sarmayex.com/crypto-price", headers=headers, timeout=15)
    html = res.get("body", "")
    if not html:
        raise RuntimeError("Sarmayex: empty response")

    out: list[dict[str, Any]] = []
    seen = set()

    matches = re.findall(r'"([0-9]{6,14}\.[0-9]+)"(?:(?!"[0-9]{6,14}\.").)*?"([A-Z0-9]+)_IRT"', html)
    for price_raw, symbol_raw in matches:
        symbol = symbol_raw.upper()
        if symbol in ("IRT", "IRR") or symbol in seen:
            continue
        if not coin_allowed(coins, symbol):
            continue

        seen.add(symbol)
        price = num(price_raw, {"decimalPlaces": 8})

        out.append({
            "currency": "IRR",
            "symbol": symbol,
            "price": price,
            "volume_1d": 0,
            "coin_volume_1d": 0,
            "change_1d": 0,
            "source": "sarmayex",
        })

    return out


def register_sarmayex() -> dict[str, Any]:
    return {
        "coin_use": "all",
        "scrape": scrape_sarmayex,
    }
