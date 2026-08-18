import dayjs from "dayjs";
import num from "../../runtime/js/num.js";
import { axiosRequest } from "../../runtime/js/request.js";

const PLATFORM = "Bitpin";
const URL = "https://api.bitpin.ir/v1/";
const MAX_PAGES = 50;

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
  const data = await fetchAllMarkets();
  if (!data?.length) {
    throw new Error("Response data is empty");
  }
  return processList(data, $filterCoins);
}

/** Follow Django-style `next` pagination (and page=N fallback). */
async function fetchAllMarkets() {
  const all = [];
  let nextUrl = null;
  let page = 1;

  for (let i = 0; i < MAX_PAGES; i++) {
    const result = nextUrl
      ? await axiosRequest({ method: "get", url: nextUrl })
      : await axiosRequest({
          method: "get",
          url: `${URL}mkt/markets/`,
          params: page > 1 ? { page } : {},
        });

    if (!result?.results || !Array.isArray(result.results)) {
      throw new Error("Invalid response data");
    }
    all.push(...result.results);

    if (result.next) {
      nextUrl = result.next;
      continue;
    }

    const count = Number(result.count) || 0;
    if (count > 0 && all.length < count && result.results.length > 0) {
      nextUrl = null;
      page += 1;
      continue;
    }
    break;
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
      if (data?.currency2?.code !== "IRT") return false;
      if (data?.currency1?.forTest || !data?.order_book_info?.price) return false;
      const code = String(data.currency1.code || "").toUpperCase();
      return $coinsFilter.length === 0 || $coinsFilter.includes(code);
    })
    .map((data) => {
      const date = data?.internal_price_info?.created_at
        ? dayjs.unix(num(data.internal_price_info.created_at, { roundUp: true }))
        : dayjs();
      return {
        source: PLATFORM.toLowerCase(),
        currency: "IRR",
        symbol: data.currency1.code.toUpperCase(),
        price: num(data.order_book_info.price, { decimalPlaces: 8, multiply: 10 }) || 0,
        volume_1d: num(data.order_book_info.value, { multiply: 10, roundUp: true }) || 0,
        coin_volume_1d: num(data.order_book_info.amount) || 0,
        change_1d: num(data.order_book_info.change, { decimalPlaces: 2 }),
        last_update: {
          date: date.toISOString(),
          timestamp: date.unix(),
          moment: date,
        },
      };
    });
}
