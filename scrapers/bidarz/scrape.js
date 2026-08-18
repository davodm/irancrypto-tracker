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

export async function scrape($coins = []) {
  return await getLatest($coins);
}

export async function getLatest($filterCoins = []) {
  const targetCoins = $filterCoins.length > 0 ? $filterCoins : POPULAR_COINS;
  const date = dayjs();

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
          timeout: 10000,
        });

        const html =
          typeof response.data === "string" ? response.data : JSON.stringify(response.data);
        if (html) {
          const match = html.match(/quoteId:"IRR"[^}]*?last:"([0-9.]+)"/);
          if (match?.[1]) {
            const rawPrice = parseFloat(match[1]) || 0;
            return {
              source: PLATFORM.toLowerCase(),
              currency: "IRR",
              symbol: coin.toUpperCase(),
              price: num(rawPrice, { decimalPlaces: 8 }) || 0,
              volume_1d: 0,
              coin_volume_1d: 0,
              change_1d: 0,
              last_update: {
                date: date.toISOString(),
                timestamp: date.unix(),
                moment: date,
              },
            };
          }
        }
      } catch {
        return null;
      }
      return null;
    });

  const results = await Promise.all(promises);
  return results.filter(Boolean);
}
