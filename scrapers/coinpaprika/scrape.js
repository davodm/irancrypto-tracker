import dayjs from "dayjs";
import num from "../../runtime/js/num.js";
import { axiosRequest } from "../../runtime/js/request.js";

const PLATFORM = "CoinPaprika";
const URL = "https://api.coinpaprika.com/v1/tickers";

export const COIN_USE = "all";

/**
 * @param {string[]} $filterCoins
 * @returns {Promise<any[]>}
 */
export async function scrape($filterCoins = []) {
  const data = await request();
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error("CoinPaprika: empty tickers");
  }
  return processList(data, $filterCoins);
}

async function request() {
  return await axiosRequest({ method: "get", url: URL });
}

/**
 * Resolve ticker collisions. Several tokens share a ticker (USDT, TON, IOTA, …);
 * keep the canonical one per symbol: the exact CoinPaprika id where known, else the
 * highest-ranked entry.
 *
 * @param {any[]} $list
 * @returns {Map<string, any>} symbol -> ticker
 */
function pickBySymbol($list) {
  // Symbols whose canonical token is NOT the top-ranked one sharing the ticker.
  const canonicalId = {
    TON: "ton-tokamak-network",
    IOTA: "miota-iota",
    BTT: "bttc-bittorrent-chain",
  };
  const best = new Map();
  for (const t of $list) {
    const sym = String(t?.symbol ?? "").toUpperCase();
    if (!sym) continue;
    if (canonicalId[sym] && t.id === canonicalId[sym]) {
      best.set(sym, t);
      continue;
    }
    const rank = typeof t.rank === "number" ? t.rank : Number.MAX_SAFE_INTEGER;
    const cur = best.get(sym);
    if (!cur || rank < (typeof cur.rank === "number" ? cur.rank : Number.MAX_SAFE_INTEGER)) {
      best.set(sym, t);
    }
  }
  return best;
}

/**
 * @param {any[]} $list
 * @param {string[]} $coinsFilter
 * @returns {object[]}
 */
function processList($list, $coinsFilter = []) {
  const wanted =
    $coinsFilter.length > 0 ? new Set($coinsFilter.map((c) => String(c).toUpperCase())) : null;
  const out = [];
  for (const [sym, t] of pickBySymbol($list)) {
    if (wanted && !wanted.has(sym)) continue;
    const quote = t?.quotes?.USD;
    if (!quote) continue;

    const price = num(quote.price, { decimalPlaces: 8 }) || 0;
    const date = dayjs(t.last_updated);
    const coinVolume =
      price > 0 ? num(quote.volume_24h, { divide: price, decimalPlaces: 4 }) || 0 : 0;
    out.push({
      source: PLATFORM.toLowerCase(),
      id: t.id,
      currency: "USD",
      name: t.name,
      symbol: sym,
      price,
      volume_1d: num(quote.volume_24h, { roundUp: true }) || 0,
      coin_volume_1d: coinVolume,
      change_1d: num(quote.percent_change_24h, { decimalPlaces: 2 }) || 0,
      change_7d: num(quote.percent_change_7d, { decimalPlaces: 2 }) || 0,
      cap: num(quote.market_cap, { decimalPlaces: 0, roundUp: true }) || 0,
      market_cap: num(quote.market_cap, { decimalPlaces: 0, roundUp: true }) || 0,
      supply: t.circulating_supply || 0,
      max_supply: num(t.max_supply) || 0,
      last_update: {
        date: date.toISOString(),
        timestamp: date.unix(),
        moment: date,
      },
    });
  }
  return out;
}
