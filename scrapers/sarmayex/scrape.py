def parse_sarmayex_page(html: str, coins: list[str]) -> list[dict[str, Any]]:
    """Parse currencies from the page's `__NUXT_DATA__` payload. Every currency object holds
    payload indices; `sell.marketPrice` is the Toman mid-market rate (`sell.price` is
    Sarmayex's own marked-up quote).
    """
    m = re.search(r'<script[^>]*id="__NUXT_DATA__"[^>]*>([^<]*)</script>', html)
    if not m:
        raise RuntimeError("Sarmayex: Nuxt payload not found")
    payload = json.loads(m.group(1))
    if not isinstance(payload, list):
        raise RuntimeError("Sarmayex: invalid Nuxt payload")

    # Nuxt payload (devalue) wrappers whose second element is the index of the wrapped value.
    wrappers = {"Reactive", "ShallowReactive", "Ref", "ShallowRef"}

    def deref(index: Any) -> Any:
        if not isinstance(index, int) or isinstance(index, bool) or not 0 <= index < len(payload):
            return None
        value = payload[index]
        while isinstance(value, list) and value and value[0] in wrappers:
            value = payload[value[1]]
        return value

    out: list[dict[str, Any]] = []
    seen: set[str] = set()

    for node in payload:
        if not isinstance(node, dict) or not {"symbol", "sell", "markets"} <= node.keys():
            continue
        symbol = str(deref(node["symbol"]) or "").upper()
        if not symbol or symbol in seen or not coin_allowed(coins, symbol):
            continue
        markets = deref(node["markets"])
        if not isinstance(markets, list) or f"{symbol}_IRT" not in [deref(i) for i in markets]:
            continue
        sell = deref(node["sell"])
        price_toman = num(deref(sell.get("marketPrice")) if isinstance(sell, dict) else 0)
        if price_toman <= 0:
            continue

        seen.add(symbol)
        out.append({
            "currency": "IRR",
            "symbol": symbol,
            "price": num(price_toman, {"multiply": 10, "decimalPlaces": 8}),
            "volume_1d": 0,
            "coin_volume_1d": 0,
            "change_1d": 0,
            "source": "sarmayex",
        })

    return out


def scrape_sarmayex(coins: list[str]) -> list[dict[str, Any]]:
    return parse_sarmayex_page(http_get_text("https://sarmayex.com/crypto-price"), coins)


def register_sarmayex() -> dict[str, Any]:
    return {
        "coin_use": "all",
        "scrape": scrape_sarmayex,
    }
