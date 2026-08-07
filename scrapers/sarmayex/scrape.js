import dayjs from "dayjs";
import num from "../../runtime/js/num.js";
import axios from "axios";

const PLATFORM = "Sarmayex";
const URL = "https://sarmayex.com/crypto-price";

export const COIN_USE = "all";

export async function scrape($coins = []) {
  const data = await getLatest($coins);
  data.forEach((d) => {
    d.source = PLATFORM.toLowerCase();
  });
  return data;
}

export async function getLatest($filterCoins = []) {
  const response = await axios.get(URL, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    },
    timeout: 15000,
  });

  const html = typeof response.data === "string" ? response.data : JSON.stringify(response.data);
  if (!html) {
    throw new Error("Response data is empty");
  }
  return processHtml(html, $filterCoins);
}

function processHtml($html, $coinsFilter = []) {
  const results = [];
  const date = dayjs();
  const seen = new Set();

  const matches = [...$html.matchAll(/"([0-9]{6,14}\.[0-9]+)"(?:(?!"[0-9]{6,14}\.").)*?"([A-Z0-9]+)_IRT"/g)];

  for (const match of matches) {
    const symbol = match[2].toUpperCase();
    if (symbol === "IRT" || symbol === "IRR") continue;
    if (seen.has(symbol)) continue;
    if ($coinsFilter.length > 0 && !$coinsFilter.includes(symbol)) continue;

    seen.add(symbol);
    const rawPrice = parseFloat(match[1]) || 0;

    results.push({
      currency: "IRR",
      symbol: symbol,
      price: num(rawPrice, { decimalPlaces: 8 }) || 0,
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
