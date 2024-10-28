import moment from "moment";
import num from "../lib/num.js";
import { axiosRequest } from "../lib/request.js";

const PLATFORM = "Exir";
const URL = "https://api.exir.io/v2/";

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
  const data = await request("ticker/all", {});
  if (!Object.keys(data).length) {
    throw new Error("Response data is empty");
  }
  return processList(data, $filterCoins);
}

/**
 * Send request to Exir API
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
  if (!result) {
    throw new Error("Invalid response data");
  }

  return result;
}

/**
 * Process the list of cryptocurrencies
 *
 * @param {object[]} $list List of cryptocurrencies
 * @param {string[]} $coinsFilter List of coins to filter
 * @returns {object[]} Processed list of cryptocurrencies
 */
function processList($list, $coinsFilter = []) {
  // Convert object of key=>object to array of objects
  $list = Object.keys($list).map((key) => {
    const split = key.toUpperCase().split("-");
    return {
      ...$list[key],
      symbol: split[0],
      currency: split[1],
    };
  });
  // Filter and transform the list
  return $list
    .filter((data) => {
      // Check if data is for IRR currency
      if (data.currency !== "IRT") return false;
      // Check price exists
      if (!data?.last) return false;
      // Check if the coin list is empty or includes the coin filter list
      return $coinsFilter.length === 0 || $coinsFilter.includes(data.symbol);
    })
    .map((data) => {
      // Handle last update with moment.js - get the current time
      const date = moment();
      // Convert IRT to IRR with the price
      const price =
        num(data.last || data.close, { multiply: 10, decimalPlaces: 8 }) || 0;

      // Initialize the transformed object
      return {
        currency: "IRR",
        symbol: data.symbol,
        price: price,
        // Calc volume based on the price
        volume_1d: num(data.volume, { multiply: price, roundUp: true }) || 0,
        coin_volume_1d: num(data.volume),
        last_update: {
          date: date.toISOString(),
          timestamp: date.unix(),
          moment: date,
        },
      };
    });
}
