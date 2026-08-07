def parse_tabdeal(data: Any, coins: list[str]) -> list[dict[str, Any]]:
    if not isinstance(data, list) or not data:
        raise RuntimeError("Tabdeal: empty")
    usdt = 0.0
    for item in data:
        if not isinstance(item, dict) or item.get("symbol") != "USDT":
            continue
        for m in item.get("markets") or []:
            if (m.get("second_currency") or {}).get("symbol") == "IRT" and m.get("price") is not None:
                usdt = num(m["price"], {"decimalPlaces": 8, "multiply": 10})
                break
        if usdt:
            break
    out: list[dict[str, Any]] = []
    for row in data:
        if not isinstance(row, dict) or not row.get("markets"):
            continue
        irt_market = None
        for m in row["markets"]:
            if (m.get("second_currency") or {}).get("symbol") == "IRT" and m.get("price"):
                irt_market = m
                break
        if irt_market is None:
            continue
        symbol = str(row.get("symbol") or "").upper()
        if not symbol or not coin_allowed(coins, symbol):
            continue
        out.append(
            {
                "currency": "IRR",
                "symbol": symbol,
                "price": num(irt_market["price"], {"decimalPlaces": 8, "multiply": 10}),
                "volume_1d": num(row.get("usdt_volume", 0), {"multiply": usdt, "roundUp": True}),
                "coin_volume_1d": num(row.get("volume", 0)),
                "change_1d": num(row.get("change_percent", 0), {"decimalPlaces": 2}),
                "source": "tabdeal",
            }
        )
    return out


def skip_tabdeal() -> str | None:
    return None


def job_tabdeal() -> dict[str, Any]:
    return {
        "url": "https://api-web.tabdeal.org/r/plots/currency_prices",
        "query": {"limit": 1000},
        "use_proxy": True,
    }


def register_tabdeal() -> dict[str, Any]:
    return {
        "coin_use": "all",
        "skip": skip_tabdeal,
        "job": job_tabdeal,
        "parse": parse_tabdeal,
    }
