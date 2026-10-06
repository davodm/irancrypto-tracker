from __future__ import annotations

from typing import Any


def coinpaprika_pick_by_symbol(data: list[Any]) -> dict[str, Any]:
    # Several tokens share a ticker (USDT, TON, IOTA, …); keep the canonical one per
    # symbol: the exact CoinPaprika id where known, else the highest-ranked entry.
    canonical_id = {
        "TON": "ton-tokamak-network",
        "IOTA": "miota-iota",
        "BTT": "bttc-bittorrent-chain",
    }
    best: dict[str, Any] = {}
    for t in data:
        if not isinstance(t, dict):
            continue
        sym = str(t.get("symbol") or "").upper()
        if not sym:
            continue
        rank = t.get("rank")
        rank_val = rank if isinstance(rank, int) else float("inf")
        if sym in canonical_id and t.get("id") == canonical_id[sym]:
            best[sym] = t
            continue
        cur = best.get(sym)
        if cur is None:
            best[sym] = t
            continue
        cur_rank = cur.get("rank")
        cur_rank_val = cur_rank if isinstance(cur_rank, int) else float("inf")
        if rank_val < cur_rank_val:
            best[sym] = t
    return best


def parse_coinpaprika(data: Any, coins: list[str]) -> list[dict[str, Any]]:
    if not isinstance(data, list) or not data:
        raise RuntimeError("CoinPaprika: empty tickers")
    wanted = None if not coins else {str(c).upper() for c in coins}
    out: list[dict[str, Any]] = []
    for sym, t in coinpaprika_pick_by_symbol(data).items():
        if wanted is not None and sym not in wanted:
            continue
        quote = (t.get("quotes") or {}).get("USD")
        if not isinstance(quote, dict):
            continue
        price = num(quote.get("price", 0), {"decimalPlaces": 8})
        coin_volume = num(quote.get("volume_24h", 0), {"divide": price, "decimalPlaces": 4}) if price > 0 else 0
        out.append({
            "currency": "USD",
            "symbol": sym,
            "price": price,
            "volume_1d": num(quote.get("volume_24h", 0), {"roundUp": True}),
            "coin_volume_1d": coin_volume,
            "change_1d": num(quote.get("percent_change_24h", 0), {"decimalPlaces": 2}),
            "change_7d": num(quote.get("percent_change_7d", 0), {"decimalPlaces": 2}),
            "cap": num(quote.get("market_cap", 0), {"decimalPlaces": 0, "roundUp": True}),
            "market_cap": num(quote.get("market_cap", 0), {"decimalPlaces": 0, "roundUp": True}),
            "supply": num(t.get("circulating_supply", 0)),
            "max_supply": num(t.get("max_supply", 0)),
            "source": "coinpaprika",
        })
    return out


def job_coinpaprika() -> dict[str, Any]:
    return {"url": "https://api.coinpaprika.com/v1/tickers"}


def register_coinpaprika() -> dict[str, Any]:
    return {
        "coin_use": "all",
        "job": job_coinpaprika,
        "parse": parse_coinpaprika,
    }
