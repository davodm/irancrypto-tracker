import time
from datetime import datetime, timezone
import requests

PLATFORM = "bitimen"
URL = "https://api2.bitimen.com/api/market/stats?quote_asset=IRT"

def get_latest(filter_coins=None):
    if filter_coins is None:
        filter_coins = []
    res = requests.get(URL, timeout=15)
    data = res.json()
    if not isinstance(data, dict) or not data:
        raise RuntimeError("Response data is empty")
    return process_list(data, filter_coins)

def process_list(dict_data, coins_filter):
    result = []
    now = datetime.now(timezone.utc)
    iso_date = now.isoformat()
    ts = int(now.timestamp())

    for key, item in dict_data.items():
        symbol = item.get("base_asset_ticker", "").upper()
        if not symbol:
            continue
        if coins_filter and symbol not in coins_filter:
            continue

        raw_price = item.get("last_price") or item.get("best_bid_raw") or 0
        price = float(raw_price) * 10
        raw_vol = str(item.get("volume", "0") or "0").replace(",", "")
        volume_1d = float(raw_vol) * 10
        change_1d = float(item.get("change_display") or item.get("change") or 0)

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
