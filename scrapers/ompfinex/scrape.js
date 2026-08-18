import dayjs from "dayjs";
import num from "../../runtime/js/num.js";
import { axiosRequest } from "../../runtime/js/request.js";

const PLATFORM = "OMPFinex";
const URL = "https://api.ompfinex.com/v1/market";

export const COIN_USE = "all";

export async function scrape($coins = []) {
  return await getLatest($coins);
}

export async function getLatest($filterCoins = []) {
  const response = await request("", {});
  const list = Array.isArray(response) ? response : response?.data || [];
  if (!Array.isArray(list) || list.length === 0) {
    throw new Error("Response data is empty");
  }
  return processList(list, $filterCoins);
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
  return $list
    .filter((data) => {
      const quote = data?.quote_currency?.id?.toUpperCase();
      if (quote !== "IRR" && quote !== "IRT") return false;
      if (!data?.last_price) return false;
      const symbol = data?.base_currency?.id?.toUpperCase();
      if (!symbol) return false;
      return $coinsFilter.length === 0 || $coinsFilter.includes(symbol);
    })
    .map((data) => {
      const date = dayjs();
      const symbol = data.base_currency.id.toUpperCase();
      return {
        source: PLATFORM.toLowerCase(),
        currency: "IRR",
        symbol: symbol,
        price: num(data.last_price, { multiply: 10, decimalPlaces: 8 }) || 0,
        volume_1d: num(data.last_volume, { multiply: 10, roundUp: true }) || 0,
        coin_volume_1d: 0,
        change_1d: num(data.day_change_percent, { decimalPlaces: 2 }) || 0,
        last_update: {
          date: date.toISOString(),
          timestamp: date.unix(),
          moment: date,
        },
      };
    });
}
