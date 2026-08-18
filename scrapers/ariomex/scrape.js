import dayjs from "dayjs";
import num from "../../runtime/js/num.js";
import { axiosRequest } from "../../runtime/js/request.js";

const PLATFORM = "Ariomex";
const BASE_URL = "https://data.ariomex.ir/exchange_data/markets_details";
const MAX_ROWS = 200;
const MAX_PAGES = 20;

export const COIN_USE = "all"; // own, all, none

/**
 * @param {string[]} $coins
 */
export async function scrape($coins = []) {
  return await getLatest($coins);
}

/**
 * @param {string[]} $filterCoins
 */
export async function getLatest($filterCoins = []) {
  const data = await fetchAllPages();
  if (!data?.length) {
    throw new Error("Response data is empty");
  }
  return processList(data, $filterCoins);
}

async function fetchAllPages() {
  const all = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const result = await axiosRequest({
      method: "get",
      url: BASE_URL,
      params: {
        maxRowsPerPage: MAX_ROWS,
        page,
        resolution: "1d",
        quote: "irt",
      },
    });

    if (!result?.status || result.status !== "true") {
      throw new Error(`Invalid response status (${result?.status}): ${result?.message}`);
    }
    if (!result?.result || !Array.isArray(result.result)) {
      throw new Error("Invalid response data");
    }
    if (result.result.length === 0) break;
    all.push(...result.result);
    if (result.result.length < MAX_ROWS) break;
  }
  return all;
}

/**
 * @param {any[]} $list
 * @param {string[]} $coinsFilter
 */
function processList($list, $coinsFilter = []) {
  return $list
    .filter((data) => {
      if (!data?.last_price) return false;
      return $coinsFilter.length === 0 || $coinsFilter.includes(String(data.base).toUpperCase());
    })
    .map((data) => {
      const date = dayjs();
      const coinVolume = num(data.volume) || 0;
      const priceIRT = num(data.last_price) || 0;
      const volumeIRT = coinVolume * priceIRT;
      return {
        source: PLATFORM.toLowerCase(),
        currency: "IRR",
        symbol: data.base.toUpperCase(),
        price: num(data.last_price, { decimalPlaces: 8, multiply: 10 }) || 0,
        volume_1d: num(volumeIRT, { multiply: 10, roundUp: true }) || 0,
        coin_volume_1d: coinVolume,
        change_1d: num(data.change_percentage, { decimalPlaces: 2 }),
        last_update: {
          date: date.toISOString(),
          timestamp: date.unix(),
          moment: date,
        },
      };
    });
}
