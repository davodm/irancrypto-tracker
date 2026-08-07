import dayjs from "dayjs";
import num from "../../runtime/js/num.js";
import { axiosRequest } from "../../runtime/js/request.js";

const PLATFORM = "Tetherland";
const URL = "https://api.tetherland.com/currencies";

export const COIN_USE = "all";

export async function scrape($coins = []) {
  const data = await getLatest($coins);
  data.forEach((d) => {
    d.source = PLATFORM.toLowerCase();
  });
  return data;
}

export async function getLatest($filterCoins = []) {
  const data = await request("", {});
  if (!data?.data?.currencies || Object.keys(data.data.currencies).length === 0) {
    throw new Error("Response data is empty");
  }
  return processList(data.data.currencies, $filterCoins);
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
    .filter((symbol) => {
      const upper = symbol.toUpperCase();
      return $coinsFilter.length === 0 || $coinsFilter.includes(upper);
    })
    .map((symbol) => {
      const data = $list[symbol];
      const date = dayjs();
      return {
        currency: "IRR",
        symbol: symbol.toUpperCase(),
        price: num(data.price || data.buy_price, { multiply: 10, decimalPlaces: 8 }) || 0,
        volume_1d: 0,
        coin_volume_1d: 0,
        change_1d: num(data.diff24d, { decimalPlaces: 2 }) || 0,
        last_update: {
          date: date.toISOString(),
          timestamp: date.unix(),
          moment: date,
        },
      };
    });
}
