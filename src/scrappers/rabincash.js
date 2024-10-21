// They don't have volume anymore
import axios from "axios";
import moment from "moment";
import { JSONizeResponse } from "../lib/utils.js";
import { TIMEOUT, USER_AGENT } from "../lib/vars.js";
import num from "../lib/num.js";

const PLATFORM = "RabinCash";
const URL = "https://gateway.raabin.net/api/v2/";

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
  const data = await request("rabincryptos", {});
  if (!data?.length) {
    throw new Error("Response data is empty");
  }
  return processList(data, $filterCoins);
}

/**
 * Send request to RabinCash API
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
      // find _irt in object name for IRT market
      if (!data?.markets.hasOwnProperty(`${data.name}_irt`)) return false;
      // Check price exists
      if (!data?.otc_buy_sell?.sell) return false;
      // Check if the coin list is empty or includes the coin filter list
      return (
        $coinsFilter.length === 0 ||
        $coinsFilter.includes(data.name.toUpperCase())
      );
    })
    .map((data) => {
      // Handle last update with moment.js
      const date = moment();

      // Calculate the price that might be used in calculations of volume
      const price =
        num(data.otc_buy_sell.sell, { decimalPlaces: 8, multiply: 10 }) || 0;

      // Calculate the change
      const change = num(
        num(
          data.otc_buy_sell.buy - data.markets[`${data.name}_irt`].old_price,
          {
            decimalPlaces: 2,
            divide: data.markets[`${data.name}_irt`].old_price,
          }
        ) || 0
      );

      // Initialize the transformed object
      return {
        currency: "IRR",
        symbol: data.name.toUpperCase(),
        // * 10 to convert to IRR
        price: price,
        // Volume doesn't exist in the response anymore
        volume_1d: 0,
        coin_volume_1d: 0,
        change_1d: change,
        last_update: {
          date: date.toISOString(),
          timestamp: date.unix(),
          moment: date,
        },
      };
    });
}
