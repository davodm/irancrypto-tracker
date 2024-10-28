import { logError, logInfo } from "../lib/logger.js";
import { captureError } from "../lib/sentry.js";
import moment from "moment";
import num from "../lib/num.js";
import { axiosRequest } from "../lib/request.js";

const PLATFORM = "Nobitex";
const URL = "https://api.nobitex.ir/";
const RESEND_REQUEST = true;

// Define for automation to which coins to filter are gonna be used
export const COIN_USE = "own"; // own, all, none

/**
 * Scrape to use in automation
 * @param {string[]} $coins - List of coins to filter
 */
export async function scrape($coins) {
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
 * @param {string[]} $filterCoins List of coins to query and filter
 * @returns {Promise<object>} Response data from api
 */
export async function getLatest($filterCoins) {
  try {
    if(!$filterCoins || !$filterCoins.length) {
      throw new Error("No coins to query");
    }

    const data = await request("market/stats", {
      srcCurrency: $filterCoins.join(","),
      dstCurrency: "RLS", // IRR
    });

    if(!data?.stats || !Object.keys(data.stats).length) {
      throw new Error("Response data is empty");
    }

    return processList(data.stats, $filterCoins);
  } catch (error) {
    // Check if the error is due to invalid currency
    if (RESEND_REQUEST && error.message.includes("Invalid currency")) {
      const invalidSymbol = error.message.split(":")[1].trim();
      logInfo("Requesting again without invalid currency: " + invalidSymbol);
      $filterCoins = $filterCoins.filter((coin) => coin !== invalidSymbol);
      return await getLatest($filterCoins);
    } else {
      throw error;
    }
  }
}

/**
 * Send request to Nobitex API
 *
 * @param {string} $uri URI of the endpoint
 * @param {object} $params object of query parameters
 * @returns {Promise<object>} Response data from api
 */
async function request($uri, $params = {}) {
  // Send request via axios helper
  let result;
  try{
    result = await axiosRequest({
      method: "get",
      url: URL + $uri,
      params: $params,
      throwOriginalError: true,
    });
  }catch(error){
    // Check error of invalid currency
    if (
      error?.response?.data?.code === "InvalidCurrency" &&
      error?.response?.data?.message
    ) {
      logError(`Nobitex Invalid currency: ${error.response.data.message}`);
      captureError(`Nobitex Invalid currency: ${error.response.data.message}`);
      const invalidSymbol = extractInvalidSymbol(error.response.data.message);
      if (invalidSymbol) {
        throw new Error(`Invalid currency: ${invalidSymbol}`);
      }
    }

    throw new Error(
      `Failed to send request to ${URL + $uri} server due to ${error.message}`
    );
  }

  // Validate status
  if (result?.status && result.status !== "ok") {
    throw new Error("Invalid response status: " + result.status);
  }

  return result;
}

/**
 * Process the list of cryptocurrencies from Nobitex API
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
      // Check if is closed
      if (data.closed) return false;
      // Check if the coin list is empty or includes the coin filter list
      return $coinsFilter.length === 0 || $coinsFilter.includes(data.symbol);
    })
    .map((data) => {
      // Handle last update with moment.js - get the current time
      const date = moment();

      // Initialize the transformed object
      return {
        currency: "IRR",
        symbol: data.symbol,
        price: num(data.latest, { decimalPlaces: 8 }) || 0,
        volume_1d: num(data.volumeDst, { roundUp: true }) || 0,
        coin_volume_1d: num(data.volumeSrc) || 0,
        change_1d: num(data.dayChange, { decimalPlaces: 2 }) || 0,
        last_update: {
          date: date.toISOString(),
          timestamp: date.unix(),
          moment: date,
        },
      };
    });
}

/**
 * Extracts the invalid symbol from the error message.
 * Assumes the error message format: 'The symbol "symbol" is not a valid currency.'
 * @param {string} message - The error message from the API.
 * @returns {string|null} - The invalid symbol or null if not found.
 */
function extractInvalidSymbol(message) {
  const regex = /The symbol "(.+?)" is not a valid currency\./i;
  const match = message.match(regex);
  return match ? match[1] : null;
}
