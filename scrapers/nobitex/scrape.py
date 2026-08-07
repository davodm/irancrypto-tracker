def parse_nobitex(data: Any, coins: list[str]) -> list[dict[str, Any]]:
    if not isinstance(data, dict) or not isinstance(data.get("stats"), dict) or not data["stats"]:
        raise RuntimeError("Nobitex: empty stats")
    if "status" in data and data["status"] != "ok":
        raise RuntimeError("Nobitex: invalid status")
    out: list[dict[str, Any]] = []
    for key, row in data["stats"].items():
        if not isinstance(row, dict) or row.get("isClosed"):
            continue
        symbol = str(key).upper().split("-")[0]
        if not symbol or not coin_allowed(coins, symbol):
            continue
        out.append(
            {
                "currency": "IRR",
                "symbol": symbol,
                "price": num(row.get("latest", 0), {"decimalPlaces": 8}),
                "volume_1d": num(row.get("volumeDst", 0), {"roundUp": True}),
                "coin_volume_1d": num(row.get("volumeSrc", 0)),
                "change_1d": num(row.get("dayChange", 0), {"decimalPlaces": 2}),
                "source": "nobitex",
            }
        )
    return out


def job_nobitex() -> dict[str, Any]:
    return {
        "url": "https://apiv2.nobitex.ir/market/stats",
        "query": {"dstCurrency": "rls"},
        "headers": {
            "Origin": "https://nobitex.ir",
            "Referer": "https://nobitex.ir/",
        },
    }


def register_nobitex() -> dict[str, Any]:
    return {
        "coin_use": "own",
        "job": job_nobitex,
        "parse": parse_nobitex,
    }
