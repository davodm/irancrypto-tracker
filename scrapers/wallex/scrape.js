import dayjs from "dayjs";
import num from "../../runtime/js/num.js";
import { axiosRequest } from "../../runtime/js/request.js";

const PLATFORM = "Wallex";
const URL = "https://api.wallex.ir/v1/";

// Define for automation to which coins to filter are gonna be used
export const COIN_USE = "all"; // own, all, none

/**
 * Scrape to use in automation
 * @param {string[]} $coins - List of coins to filter
 */
export async function scrape($coins = []) {
  // Get the list of prices
  const data = await getLatest($coins);
  // Sign the data with platform name
  data.forEach((d) => {
    d.source = PLATFORM.toLowerCase();
  });

  return data;
}

/**
 * Get latest prices of cryptocurrencies
 *
 * @param {string[]} $filterCoins List of coins to filter
 * @returns {Promise<any[]>} Response data from api
 */
export async function getLatest($filterCoins = []) {
  const data = await request("markets", {});
  if (!data?.symbols || Object.keys(data.symbols).length === 0) {
    throw new Error("Response data is empty");
  }
  return processList(data.symbols, $filterCoins);
}

/**
 * Send request to Wallex API
 *
 * @param {string} $uri URI of the endpoint
 * @param {object} $params object of query parameters
 * @returns {Promise<any>} Response data from api
 */
async function request($uri, $params = {}) {
  // Send request via axios helper
  const result = await axiosRequest({
    method: "get",
    url: URL + $uri,
    params: $params,
  });

  // Validate response data
  if (!result?.result) {
    throw new Error("Invalid response data");
  }

  return result.result;
}

/**
 * Process the list of cryptocurrencies
 *
 * @param {Record<string, any>} $list List of cryptocurrencies
 * @param {string[]} $coinsFilter List of coins to filter
 * @returns {object[]} Processed list of cryptocurrencies
 */
function processList($list, $coinsFilter = []) {
  // Convert object of key=>object to array of objects
  $list = Object.keys($list).map((key) => $list[key]);
  // Filter and transform the list
  return $list
    .filter((data) => {
      // Check if data is for IRR currency
      if (data?.quoteAsset?.toUpperCase() !== "TMN") return false;
      // Check if the price exists
      if (!data?.stats?.lastPrice) return false;
      // Check if the coin list is empty or includes the coin filter list
      return $coinsFilter.length === 0 || $coinsFilter.includes(data.baseAsset.toUpperCase());
    })
    .map((data) => {
      const date = dayjs();

      // Initialize the transformed object
      return {
        currency: "IRR",
        symbol: data.baseAsset.toUpperCase(),
        // *10 for the price to be in IRR
        price: num(data.stats.lastPrice, { multiply: 10, decimalPlaces: 8 }) || 0,
        // *10 for the volume to be in IRR
        volume_1d: num(data.stats["24h_quoteVolume"], { roundUp: true, multiply: 10 }) || 0,
        coin_volume_1d: num(data.stats["24h_volume"]) || 0,
        change_1d: num(data.stats["24h_ch"], { decimalPlaces: 2 }),
        change_7d: num(data.stats["7d_ch"], { decimalPlaces: 2 }),
        last_update: {
          date: date.toISOString(),
          timestamp: date.unix(),
          moment: date,
        },
      };
    });
}
