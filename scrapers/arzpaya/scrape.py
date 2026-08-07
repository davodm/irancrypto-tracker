import time
from datetime import datetime, timezone
import requests

PLATFORM = "arzpaya"
URL = "https://na1.arzpaya.com/orderbook/buy/irt/"

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
            data = res.json()
            if data and "Data" in data and isinstance(data["Data"], list) and len(data["Data"]) > 0:
                top_bid = data["Data"][0]
                price = float(top_bid["p"]) * 10
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
