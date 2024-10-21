import axios from "axios";
import moment from "moment";
import { JSONizeResponse } from "../lib/utils.js";
import { TIMEOUT, USER_AGENT } from "../lib/vars.js";
import num from "../lib/num.js";

const PLATFORM = "Ariomex"; // Should be the same as the filename without .js
const URL = "https://ariomex.com/home_page/";

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
    // Better to throw right and process the errors in the main script
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
  const data = await request("get_home_page_data", {});
  if (!data?.market_data?.irt || !data?.market_data?.irt.length) {
    throw new Error("Response data is empty");
  }
  return processList(data.market_data.irt, $filterCoins);
}

/**
 * Send request to Ariomex API
 *
 * @param {string} $uri URI of the endpoint
 * @param {object} $params object of query parameters
 * @returns {Promise<object>} Response data from api
 */
async function request($uri, $params = []) {
  let response;
  try {
    response = await axios.get(URL + $uri, {
      headers: {
        Accept: "application/json",
        "User-Agent": USER_AGENT,
      },
      timeout: TIMEOUT * 1000,
      params: $params,
    });
  } catch (error) {
    throw new Error(
      `Failed to send request to ${PLATFORM} server due to ${error.message}`
    );
  }

  // Check if the response is valid or convert it to valid JSON
  const result = JSONizeResponse(response);

  // Validate status
  if (!result?.status || result.status !== "true") {
    throw new Error(
      `Invalid response status (${result.status}): ${result.message}`
    );
  }

  // Validate response data
  if (!result?.message || !Object.keys(result.message).length) {
    throw new Error("Invalid response data");
  }

  return result.message;
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
      // Check it's not for test and price exists
      if (!data?.last_price) return false;
      // Check if the coin list is empty or includes the coin filter list
      return (
        $coinsFilter.length === 0 ||
        $coinsFilter.includes(data.coin.toUpperCase())
      );
    })
    .map((data) => {
      // Handle last update with moment.js
      const date = moment();

      // Initialize the transformed object
      return {
        currency: "IRR",
        symbol: data.coin.toUpperCase(),
        // * 10 to convert to IRR
        price: num(data.last_price, { decimalPlaces: 8, multiply: 10 }) || 0,
        // * 10 to convert to IRR
        volume_1d:
          num(data["24h_volume_total"], { multiply: 10, roundUp: true }) || 0,
        coin_volume_1d: num(data["volume_24_hour"]) || 0,
        change_1d: num(data.change_24_hour, { decimalPlaces: 2 }),
        last_update: {
          date: date.toISOString(),
          timestamp: date.unix(),
          moment: date,
        },
      };
    });
}
