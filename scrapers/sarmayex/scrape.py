from __future__ import annotations

from typing import Any

URL = "https://api.sarmayex.com/api/v2/currencies"


def parse_sarmayex(data: Any, coins: list[str]) -> list[dict[str, Any]]:
    """Parse currencies from the Sarmayex v2 JSON API. `sell.marketPrice` is the
    Toman mid-market rate (`sell.price` is Sarmayex's own marked-up quote). Only
    coins with a live `<symbol>_IRT` market are quoted in IRT.
    """
    if not isinstance(data, dict):
        raise RuntimeError("Sarmayex: invalid payload")
    currencies = data.get("data", {}).get("currencies")
    if not isinstance(currencies, list) or not currencies:
        raise RuntimeError("Sarmayex: empty currencies")

    wanted = None if not coins else {str(c).upper() for c in coins}
    setting = data.get("data", {}).get("setting") or {}
    last_update = setting.get("lastUpdate")
    last_update = int(last_update) if isinstance(last_update, (int, str)) and str(last_update).isdigit() else 0

    out: list[dict[str, Any]] = []
    for c in currencies:
        if not isinstance(c, dict):
            continue
        symbol = str(c.get("symbol") or "").upper()
        if not symbol or (wanted is not None and symbol not in wanted):
            continue
        markets = c.get("markets") if isinstance(c.get("markets"), list) else []
        if f"{symbol}_IRT" not in markets:
            continue
        sell = c.get("sell") if isinstance(c.get("sell"), dict) else None
        price_toman = num(sell.get("marketPrice") if sell else 0)
        if price_toman <= 0:
            continue
        out.append({
            "currency": "IRR",
            "symbol": symbol,
            "price": num(price_toman, {"multiply": 10, "decimalPlaces": 8}),
            "volume_1d": 0,
            "coin_volume_1d": 0,
            "change_1d": num(c.get("percentChange_24h"), {"decimalPlaces": 2}),
            "change_7d": num(c.get("percentChange_7d"), {"decimalPlaces": 2}),
            "source": "sarmayex",
        })
    return out


def job_sarmayex() -> dict[str, Any]:
    return {"url": URL}


def register_sarmayex() -> dict[str, Any]:
    return {
        "coin_use": "all",
        "job": job_sarmayex,
        "parse": parse_sarmayex,
    }
