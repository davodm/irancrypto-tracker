import time
from datetime import datetime, timezone
import requests

PLATFORM = "tetherland"
URL = "https://api.tetherland.com/currencies"

def get_latest(filter_coins=None):
    if filter_coins is None:
        filter_coins = []
    res = requests.get(URL, timeout=15)
    data = res.json()
    currencies = data.get("data", {}).get("currencies", {})
    if not currencies:
        raise RuntimeError("Response data is empty")
    return process_list(currencies, filter_coins)

def process_list(currencies, coins_filter):
    result = []
    now = datetime.now(timezone.utc)
    iso_date = now.isoformat()
    ts = int(now.timestamp())

    for symbol, item in currencies.items():
        upper_symbol = symbol.upper()
        if coins_filter and upper_symbol not in coins_filter:
            continue

        raw_price = item.get("price") or item.get("buy_price") or 0
        price = float(raw_price) * 10
        change_1d = float(item.get("diff24d", 0) or 0)

        result.append({
            "source": PLATFORM,
            "currency": "IRR",
            "symbol": upper_symbol,
            "price": price,
            "volume_1d": 0,
            "coin_volume_1d": 0,
            "change_1d": round(change_1d, 2),
            "last_update": {
                "date": iso_date,
                "timestamp": ts,
            }
        })

    return result
