import dayjs from "dayjs";
import num from "../../runtime/js/num.js";
import { axiosRequest } from "../../runtime/js/request.js";

const PLATFORM = "Sarmayex";
const URL = "https://api.sarmayex.com/api/v2/currencies";

export const COIN_USE = "all";

/**
 * @param {string[]} $filterCoins
 * @returns {Promise<any[]>}
 */
export async function scrape($filterCoins = []) {
  const data = await axiosRequest({ method: "get", url: URL });
  const currencies = data?.data?.currencies;
  if (!Array.isArray(currencies) || currencies.length === 0) {
    throw new Error("Sarmayex: empty currencies");
  }
  const lastUpdate = Number(data?.data?.setting?.lastUpdate) || 0;
  return processList(currencies, $filterCoins, lastUpdate);
}

/**
 * `sell.marketPrice` is the Toman mid-market rate (`sell.price` is Sarmayex's own
 * marked-up quote). Only coins with a live `<symbol>_IRT` market are quoted in IRT.
 *
 * @param {any[]} $list
 * @param {string[]} $coinsFilter
 * @param {number} $lastUpdate
 * @returns {any[]}
 */
export function processList($list, $coinsFilter = [], $lastUpdate = 0) {
  const wanted =
    $coinsFilter.length > 0 ? new Set($coinsFilter.map((c) => String(c).toUpperCase())) : null;
  const date = $lastUpdate > 0 ? dayjs.unix($lastUpdate) : dayjs();
  const out = [];
  for (const c of $list) {
    if (!c || typeof c !== "object" || Array.isArray(c)) continue;
    const symbol = String(c.symbol ?? "").toUpperCase();
    if (!symbol || (wanted && !wanted.has(symbol))) continue;
    const markets = Array.isArray(c.markets) ? c.markets : [];
    if (!markets.includes(`${symbol}_IRT`)) continue;
    const sell = c.sell && typeof c.sell === "object" ? c.sell : null;
    const priceToman = num(sell?.marketPrice);
    if (priceToman <= 0) continue;
    out.push({
      source: PLATFORM.toLowerCase(),
      currency: "IRR",
      symbol,
      price: num(priceToman, { multiply: 10, decimalPlaces: 8 }),
      volume_1d: 0,
      coin_volume_1d: 0,
      change_1d: num(c.percentChange_24h, { decimalPlaces: 2 }) || 0,
      change_7d: num(c.percentChange_7d, { decimalPlaces: 2 }) || 0,
      last_update: {
        date: date.toISOString(),
        timestamp: date.unix(),
        moment: date,
      },
    });
  }
  return out;
}
