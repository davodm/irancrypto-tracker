import axios from "axios";
import dayjs from "dayjs";
import num from "../../runtime/js/num.js";

const PLATFORM = "Bidarz";
const URL = "https://bidarz.ir/price/";

export const COIN_USE = "all";

const POPULAR_COINS = [
  "BTC",
  "ETH",
  "USDT",
  "LTC",
  "BCH",
  "TRX",
  "DOGE",
  "LINK",
  "XRP",
  "SOL",
  "ADA",
];

// Bidarz rounds Toman prices to whole units; below this the rounding error exceeds 1%.
const MIN_PRICE_TOMAN = 100;

export async function scrape($coins = []) {
  return await getLatest($coins);
}

export async function getLatest($filterCoins = []) {
  const targetCoins = $filterCoins.length > 0 ? $filterCoins : POPULAR_COINS;

  const promises = targetCoins
    .filter((coin) => coin !== "IRT" && coin !== "IRR")
    .map(async (coin) => {
      try {
        const response = await axios.get(URL + coin.toLowerCase(), {
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
            Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          },
          responseType: "text",
          timeout: 10000,
        });
        return parsePage(response.data, coin);
      } catch {
        return null;
      }
    });

  const results = await Promise.all(promises);
  return results.filter(Boolean);
}

/**
 * Parse the IRT ticker embedded in a Bidarz price page (`quoteId:"IRR"` is labelled Toman,
 * and its prices and volume are in Toman).
 *
 * Returns null when the market is missing, idle for 24h, or too imprecise.
 *
 * @param {string} $html
 * @param {string} $coin
 */
export function parsePage($html, $coin) {
  const ticker = String($html).match(/\{[^{}]*quoteId:"IRR"[^{}]*\}/)?.[0];
  if (!ticker) return null;

  const field = (key) => {
    const raw = ticker.match(new RegExp(`[{,]${key}:"?(-?[0-9]*\\.?[0-9]+)`))?.[1];
    return raw === undefined ? 0 : Number(raw);
  };

  const priceToman = field("last");
  // A zero 24h high means no trades, so `last` is stale.
  if (priceToman < MIN_PRICE_TOMAN || field("max24h") <= 0) return null;

  const volumeToman = field("volume24h");
  const date = dayjs();
  return {
    source: PLATFORM.toLowerCase(),
    currency: "IRR",
    symbol: $coin.toUpperCase(),
    price: num(priceToman, { multiply: 10, decimalPlaces: 8 }),
    volume_1d: num(volumeToman, { multiply: 10, roundUp: true }),
    coin_volume_1d: num(volumeToman, { divide: priceToman }),
    change_1d: num(field("changePercent24h"), { decimalPlaces: 2 }),
    change_7d: num(field("changePercent7d"), { decimalPlaces: 2 }),
    last_update: {
      date: date.toISOString(),
      timestamp: date.unix(),
      moment: date,
    },
  };
}
