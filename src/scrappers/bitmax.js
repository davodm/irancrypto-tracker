import axios from "axios";
import moment from "moment";
import { JSONizeResponse } from "../lib/utils.js";
import { TIMEOUT, USER_AGENT } from "../lib/vars.js";
import num from "../lib/num.js";

const PLATFORM = "BitMax"; // Should be the same as the filename without .js
const URL = "https://api.bitmax.ir/";

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
  const data = await request("watcher/price/coins/stat", {});
  if (!data?.length) {
    throw new Error("Response data is empty");
  }
  return processList(data, $filterCoins);
}

/**
 * Send request to BitMax API
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

  // Validate response error
  if (result?.error) {
    throw new Error(`Response failed due to ${result?.message}`);
  }

  // Validate response data
  if (!result?.message) {
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
  // Find USDT Price first to calculate Vols
  const usdt = priceUSDT($list);

  return $list
    .filter((data) => {
      // Currency is in USDT
      // Check price exists
      if (!data?.last_price_irt) return false;
      // Check if the coin list is empty or includes the coin filter list
      return (
        $coinsFilter.length === 0 ||
        $coinsFilter.includes(data.symbol.toUpperCase())
      );
    })
    .map((data) => {
      // Handle last update with moment.js
      const date = moment();

      // Initialize the transformed object
      return {
        currency: "IRR",
        symbol: data.symbol.toUpperCase(),
        // * 10 to convert to IRR
        price:
          num(data.last_price_irt, { decimalPlaces: 8, multiply: 10 }) || 0,
        // * 10 to convert to IRR
        volume_1d: num(data.volume_irt, { multiply: 10, roundUp: true }) || 0,
        coin_volume_1d: num(data.volume, { divide: usdt }) || 0,
        change_1d: num(data.price_change_percent, { decimalPlaces: 2 }),
        last_update: {
          date: date.toISOString(),
          timestamp: date.unix(),
          moment: date,
        },
      };
    });
}

// Find USDT Price separately
function priceUSDT($list) {
  let item = $list.filter((item) => item?.market === "USDTIRT");
  if (!item.length) return 0;
  // * 10 to convert to IRR
  const price =
    num(item[0].last_price_irt, { decimalPlaces: 8, multiply: 10 }) || 0;

  return typeof price?.toNumber === "function" ? price.toNumber() : price;
}
