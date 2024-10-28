import moment from "moment";
import num from "../lib/num.js";
import { axiosRequest } from "../lib/request.js";

const PLATFORM = "Excoino";
const URL = "https://market-api.excoino.com/";

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
  const data = await request("market/symbol-thumb-trend", {});
  if (!data?.length) {
    throw new Error("Response data is empty");
  }
  return processList(data, $filterCoins);
}

/**
 * Send request to Excoino API
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
  return $list
    .filter((data) => {
      const split = data.symbol.toUpperCase().split("/");
      // Check it's in IRR quote
      if (split.length === 2 && split[1] !== "IRR") return false;
      // Check price exists
      if (!data?.trend?.length) return false;
      // Check if the coin list is empty or includes the coin filter list
      return (
        $coinsFilter.length === 0 ||
        $coinsFilter.includes(split[0])
      );
    })
    .map((data) => {
      // Handle last update with moment.js
      const date = moment();

      // Initialize the transformed object
      return {
        currency: "IRR",
        symbol: data.symbol.split("/")[0],
        price: num(data.trend[0], { decimalPlaces: 8 }) || 0,
        volume_1d: num(data.twentyFourHourTurnover, { roundUp: true }) || 0,
        coin_volume_1d: num(data.twentyFourHourVolume) || 0,
        change_1d: num(data.chg, { decimalPlaces: 2 }),
        last_update: {
          date: date.toISOString(),
          timestamp: date.unix(),
          moment: date,
        },
      };
    });
}
