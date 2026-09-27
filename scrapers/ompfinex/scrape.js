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
  return parseMarkets(list, $filterCoins);
}

async function request($uri, $params = {}) {
  const result = await axiosRequest({
    method: "get",
    url: URL + $uri,
    params: $params,
  });
  return result;
}

/**
 * OMPFinex labels its Rial markets "Toman" in display names, but `quote_currency.id` is IRR
 * and `last_price` / `last_volume` are already in Rial.
 *
 * @param {any[]} $list
 * @param {string[]} $coinsFilter
 */
export function parseMarkets($list, $coinsFilter = []) {
  return $list
    .filter((data) => {
      if (data?.quote_currency?.id?.toUpperCase() !== "IRR") return false;
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
        price: num(data.last_price, { decimalPlaces: 8 }) || 0,
        volume_1d: num(data.last_volume, { roundUp: true }) || 0,
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
