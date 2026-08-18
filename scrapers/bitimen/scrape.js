import dayjs from "dayjs";
import num from "../../runtime/js/num.js";
import { axiosRequest } from "../../runtime/js/request.js";

const PLATFORM = "Bitimen";
const URL = "https://api2.bitimen.com/api/market/stats?quote_asset=IRT";

export const COIN_USE = "all";

export async function scrape($coins = []) {
  return await getLatest($coins);
}

export async function getLatest($filterCoins = []) {
  const data = await request("", {});
  if (!data || typeof data !== "object" || Object.keys(data).length === 0) {
    throw new Error("Response data is empty");
  }
  return processList(data, $filterCoins);
}

async function request($uri, $params = {}) {
  const result = await axiosRequest({
    method: "get",
    url: URL + $uri,
    params: $params,
  });
  return result;
}

function processList($list, $coinsFilter = []) {
  return Object.keys($list)
    .filter((key) => {
      const data = $list[key];
      const symbol = data?.base_asset_ticker?.toUpperCase();
      if (!symbol) return false;
      return $coinsFilter.length === 0 || $coinsFilter.includes(symbol);
    })
    .map((key) => {
      const data = $list[key];
      const date = dayjs();
      const symbol = data.base_asset_ticker.toUpperCase();
      const rawPrice = data.last_price || data.best_bid_raw || 0;
      const rawVol = (data.volume || "").replace(/,/g, "");

      return {
        source: PLATFORM.toLowerCase(),
        currency: "IRR",
        symbol: symbol,
        price: num(rawPrice, { multiply: 10, decimalPlaces: 8 }) || 0,
        volume_1d: num(rawVol, { multiply: 10, roundUp: true }) || 0,
        coin_volume_1d: 0,
        change_1d: num(data.change_display || data.change, { decimalPlaces: 2 }) || 0,
        last_update: {
          date: date.toISOString(),
          timestamp: date.unix(),
          moment: date,
        },
      };
    });
}
