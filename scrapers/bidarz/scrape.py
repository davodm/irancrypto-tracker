import re
import time
from datetime import datetime, timezone
import requests

PLATFORM = "bidarz"
URL = "https://bidarz.ir/price/"

POPULAR_COINS = ["BTC", "ETH", "USDT", "LTC", "BCH", "TRX", "DOGE", "LINK", "XRP", "SOL", "ADA"]

def get_latest(filter_coins=None):
    if filter_coins is None or len(filter_coins) == 0:
        target_coins = POPULAR_COINS
    else:
        target_coins = filter_coins

    result = []
    now = datetime.now(timezone.utc)
    iso_date = now.isoformat()
    ts = int(now.timestamp())

    for coin in target_coins:
        if coin.upper() in ("IRT", "IRR"):
            continue
        try:
            res = requests.get(f"{URL}{coin.lower()}", timeout=5)
            html = res.text
            match = re.search(r'quoteId:"IRR"[^}]*?last:"([0-9.]+)"', html)
            if match:
                price = float(match.group(1))
                result.append({
                    "source": PLATFORM,
                    "currency": "IRR",
                    "symbol": coin.upper(),
                    "price": price,
                    "volume_1d": 0,
                    "coin_volume_1d": 0,
                    "change_1d": 0,
                    "last_update": {
                        "date": iso_date,
                        "timestamp": ts,
                    }
                })
        except Exception:
            pass

    return result
