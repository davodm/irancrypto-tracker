import dayjs from "dayjs";
import num from "../lib/num.js";
import { axiosRequest } from "../lib/request.js";

const PLATFORM = "Bitpin";
const URL = "https://api.bitpin.ir/v1/";

// Define for automation to which coins to filter are gonna be used
export const COIN_USE = "all"; // own, all, none

/**
 * Scrape to use in automation
 * @param {string[]} $coins - List of coins to filter
 */
export async function scrape($coins = []) {
  try {
    // Get the list of prices
    const data = await getLatest($coins);
    // Sign the data with platform name
    data.forEach((d) => {
      d.source = PLATFORM.toLowerCase();
    });

    return data;
  } catch (error) {
    throw error;
  }
}

/**
 * Get latest prices of cryptocurrencies
 *
 * @param {string[]} $filterCoins List of coins to filter
 * @returns {Promise<object>} Response data from api
 */
export async function getLatest($filterCoins = []) {
  // Should be exactly with last slash
  const data = await request("mkt/markets/", {});
  if (!data?.length) {
    throw new Error("Response data is empty");
  }
  return processList(data, $filterCoins);
}

/**
 * Send request to Bitpin API
 *
 * @param {string} $uri URI of the endpoint
 * @param {object} $params object of query parameters
 * @returns {Promise<object>} Response data from api
 */
async function request($uri, $params = {}) {
  // Send request via axios helper
  const result = await axiosRequest({
    method: "get",
    url: URL + $uri,
    params: $params,
  });

  // Validate response data
  if (!result?.results) {
    throw new Error("Invalid response data");
  }

  return result.results;
}

/**
 * Process the list of cryptocurrencies
 *
 * @param {object[]} $list List of cryptocurrencies
 * @param {string[]} $coinsFilter List of coins to filter
 * @returns {object[]} Processed list of cryptocurrencies
 */
function processList($list, $coinsFilter = []) {
  return $list
    .filter((data) => {
      // Check if data is for IRR currency
      if (data?.currency2?.code !== "IRT") return false;
      // Check it's not for test and price exists
      if (data?.currency1?.forTest || !data?.order_book_info?.price)
        return false;
      // Check if the coin list is empty or includes the coin filter list
      return (
        $coinsFilter.length === 0 || $coinsFilter.includes(data.currency1.code)
      );
    })
    .map((data) => {
      // Handle last update with moment.js
      const date = data?.internal_price_info?.created_at
        ? dayjs.unix(
            num(data.internal_price_info.created_at, { roundUp: true })
          )
        : dayjs();
      // Initialize the transformed object
      return {
        currency: "IRR",
        symbol: data.currency1.code.toUpperCase(),
        // * 10 to convert to IRR
        price:
          num(data.order_book_info.price, { decimalPlaces: 8, multiply: 10 }) ||
          0,
        // * 10 to convert to IRR
        volume_1d:
          num(data.order_book_info.value, { multiply: 10, roundUp: true }) || 0,
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
