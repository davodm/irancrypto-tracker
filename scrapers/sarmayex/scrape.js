import axios from "axios";
import dayjs from "dayjs";
import num from "../../runtime/js/num.js";

const PLATFORM = "Sarmayex";
const URL = "https://sarmayex.com/crypto-price";

export const COIN_USE = "all";

// Nuxt payload (devalue) wrappers whose second element is the index of the wrapped value.
const NUXT_WRAPPERS = new Set(["Reactive", "ShallowReactive", "Ref", "ShallowRef"]);

export async function scrape($coins = []) {
  return await getLatest($coins);
}

export async function getLatest($filterCoins = []) {
  const response = await axios.get(URL, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    },
    responseType: "text",
    timeout: 15000,
  });

  if (!response.data) {
    throw new Error("Response data is empty");
  }
  return parsePage(response.data, $filterCoins);
}

/**
 * Parse currencies from the page's `__NUXT_DATA__` payload. Every currency object holds
 * payload indices; `sell.marketPrice` is the Toman mid-market rate (`sell.price` is
 * Sarmayex's own marked-up quote).
 *
 * @param {string} $html
 * @param {string[]} $coinsFilter
 */
export function parsePage($html, $coinsFilter = []) {
  const json = String($html).match(/<script[^>]*id="__NUXT_DATA__"[^>]*>([^<]*)<\/script>/)?.[1];
  if (!json) {
    throw new Error("Nuxt payload not found");
  }
  const payload = JSON.parse(json);
  const deref = (index) => {
    let value = payload[index];
    while (Array.isArray(value) && NUXT_WRAPPERS.has(value[0])) {
      value = payload[value[1]];
    }
    return value;
  };

  const date = dayjs();
  const seen = new Set();
  const results = [];

  for (const node of payload) {
    if (!node || typeof node !== "object" || Array.isArray(node)) continue;
    if (!("symbol" in node && "sell" in node && "markets" in node)) continue;

    const symbol = String(deref(node.symbol) ?? "").toUpperCase();
    if (!symbol || seen.has(symbol)) continue;
    if ($coinsFilter.length > 0 && !$coinsFilter.includes(symbol)) continue;

    const markets = deref(node.markets);
    if (!Array.isArray(markets) || !markets.some((i) => deref(i) === `${symbol}_IRT`)) continue;

    const sell = deref(node.sell);
    const priceToman = num(sell && deref(sell.marketPrice));
    if (priceToman <= 0) continue;

    seen.add(symbol);
    results.push({
      source: PLATFORM.toLowerCase(),
      currency: "IRR",
      symbol,
      price: num(priceToman, { multiply: 10, decimalPlaces: 8 }),
      volume_1d: 0,
      coin_volume_1d: 0,
      change_1d: 0,
      last_update: {
        date: date.toISOString(),
        timestamp: date.unix(),
        moment: date,
      },
    });
  }

  return results;
}
