import re
import time
from datetime import datetime, timezone
import requests

PLATFORM = "sarmayex"
URL = "https://sarmayex.com/crypto-price"

def get_latest(filter_coins=None):
    if filter_coins is None:
        filter_coins = []
    headers = {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"}
    res = requests.get(URL, headers=headers, timeout=15)
    html = res.text
    if not html:
        raise RuntimeError("Response data is empty")
    return process_html(html, filter_coins)

def process_html(html, coins_filter):
    result = []
    now = datetime.now(timezone.utc)
    iso_date = now.isoformat()
    ts = int(now.timestamp())
    seen = set()

    matches = re.findall(r'"([0-9]{6,14}\.[0-9]+)"(?:(?!"[0-9]{6,14}\.").)*?"([A-Z0-9]+)_IRT"', html)
    for price_raw, symbol_raw in matches:
        symbol = symbol_raw.upper()
        if symbol in ("IRT", "IRR") or symbol in seen:
            continue
        if coins_filter and symbol not in coins_filter:
            continue

        seen.add(symbol)
        price = float(price_raw)

        result.append({
            "source": PLATFORM,
            "currency": "IRR",
            "symbol": symbol,
            "price": price,
            "volume_1d": 0,
            "coin_volume_1d": 0,
            "change_1d": 0,
            "last_update": {
                "date": iso_date,
                "timestamp": ts,
            }
        })

    return result
