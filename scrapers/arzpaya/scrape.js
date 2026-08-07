import dayjs from "dayjs";
import num from "../../runtime/js/num.js";
import { axiosRequest } from "../../runtime/js/request.js";

const PLATFORM = "Arzpaya";
const URL = "https://na1.arzpaya.com/orderbook/";

export const COIN_USE = "all";

const POPULAR_COINS = ["BTC", "ETH", "USDT", "LTC", "BCH", "TRX", "DOGE", "LINK", "XRP", "SOL", "ADA"];

export async function scrape($coins = []) {
  const data = await getLatest($coins);
  data.forEach((d) => {
    d.source = PLATFORM.toLowerCase();
  });
  return data;
}

export async function getLatest($filterCoins = []) {
  const targetCoins = $filterCoins.length > 0 ? $filterCoins : POPULAR_COINS;
  const date = dayjs();

  const promises = targetCoins
    .filter((coin) => coin !== "IRT" && coin !== "IRR")
    .map(async (coin) => {
      try {
        const data = await request(`buy/irt/${coin.toLowerCase()}`);
        if (data?.Data && Array.isArray(data.Data) && data.Data.length > 0) {
          const topBid = data.Data[0];
          return {
            currency: "IRR",
            symbol: coin.toUpperCase(),
            price: num(topBid.p, { multiply: 10, decimalPlaces: 8 }) || 0,
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
      } catch {
        return null;
      }
      return null;
    });

  const results = await Promise.all(promises);
  return results.filter(Boolean);
}

async function request($uri, $params = {}) {
  const result = await axiosRequest({
    method: "get",
    url: URL + $uri,
    params: $params,
  });
  return result;
}
