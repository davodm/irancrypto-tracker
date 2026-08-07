import time
from datetime import datetime, timezone
import requests

PLATFORM = "ompfinex"
URL = "https://api.ompfinex.com/v1/market"

def get_latest(filter_coins=None):
    if filter_coins is None:
        filter_coins = []
    res = requests.get(URL, timeout=15)
    data = res.json()
    list_data = data.get("data", []) if isinstance(data, dict) else (data if isinstance(data, list) else [])
    if not list_data:
        raise RuntimeError("Response data is empty")
    return process_list(list_data, filter_coins)

def process_list(list_data, coins_filter):
    result = []
    now = datetime.now(timezone.utc)
    iso_date = now.isoformat()
    ts = int(now.timestamp())

    for data in list_data:
        quote = data.get("quote_currency", {}).get("id", "").upper()
        if quote not in ("IRR", "IRT"):
            continue
        if "last_price" not in data or data["last_price"] is None:
            continue
        symbol = data.get("base_currency", {}).get("id", "").upper()
        if not symbol:
            continue
        if coins_filter and symbol not in coins_filter:
            continue

        price = float(data["last_price"]) * 10
        volume_1d = float(data.get("last_volume", 0) or 0) * 10
        change_1d = float(data.get("day_change_percent", 0) or 0)

        result.append({
            "source": PLATFORM,
            "currency": "IRR",
            "symbol": symbol,
            "price": price,
            "volume_1d": round(volume_1d),
            "coin_volume_1d": 0,
            "change_1d": round(change_1d, 2),
            "last_update": {
                "date": iso_date,
                "timestamp": ts,
            }
        })

    return result
