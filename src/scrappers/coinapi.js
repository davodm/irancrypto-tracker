// It's not quite a good replacement for CoinMarketCap.
import axios from "axios";
import moment from "moment";
import num from "../lib/num.js";
import { TIMEOUT } from "../lib/vars.js";
import { JSONizeResponse } from "../lib/utils.js";

const URL = "https://rest.coinapi.io/v1/";
const KEY = process.env.COINAPI_KEY;
const PLATFORM = "CoinAPI";

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
 * @param {number} $limit Number of items to return
 * @param {string[]} $filterCoins List of coins to filter
 * @returns {Promise<object>} Response data from api
 */
export async function getLatest($filterCoins = []) {
  const data = await request("assets", {});
  return processList(data, $filterCoins);
}

/**
 * Send request to Coin API
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
        "X-CoinAPI-Key": KEY,
        Accept: "application/json",
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
  if (!result || !result.length) {
    throw new Error("Empty response data");
  }

  return result;
}

/**
 * Processes a list of cryptocurrency data from CoinAPI
 *
 * @param {object[]} $list - List of cryptocurrencies.
 * @param {string[]} $coinsFilter - List of cryptocurrencies to filter.
 * @returns {object[]} - Processed, filtered list of cryptocurrencies.
 */
function processList($list, $coinsFilter = []) {
  return $list
    .filter((item) => {
      // Validate presence and type of 'type_is_crypto'
      if (typeof item.type_is_crypto !== "number") {
        return false;
      }

      // Check if the item is a cryptocurrency
      if (item.type_is_crypto !== 1) {
        return false;
      }

      // If coins array is empty, include all cryptocurrencies
      if ($coinsFilter.length === 0) {
        return true;
      }

      // Validate presence of 'asset_id'
      if (typeof item.asset_id !== "string") {
        return false;
      }

      // Otherwise, include only if the asset_id is in the coins array
      return $coinsFilter.includes(item.asset_id.toUpperCase());
    })
    .map((item) => {
      // Handle date from string 2024-10-15T00:00:00.0000000Z
      const date = moment(item.data_quote_end || item.data_end || undefined);

      return {
        name: item.name,
        symbol: item.asset_id.toUpperCase(),
        currency: "USD",
        price: num(item.price_usd, { decimalPlaces: 8 }) || 0,
        volume_1h: num(item.volume_1hrs_usd, { roundUp: true }) || 0,
        volume_1d: num(item.volume_1day_usd, { roundUp: true }) || 0,
        last_update: {
          date: date.toISOString(),
          timestamp: date.unix(),
          moment: date,
        },
      };
    });
}
