import dayjs from "dayjs";
import num from "../../runtime/js/num.js";
import { axiosRequest } from "../../runtime/js/request.js";

const URL = "https://rest.coinapi.io/v1/";
const KEY = process.env.COINAPI_KEY || null;
const PLATFORM = "CoinAPI";

export const COIN_USE = "all"; // own, all, none

/**
 * Scrape to use in automation
 * @param {string[]} $coins - List of coins to filter
 */
export async function scrape($coins = []) {
  return await getLatest($coins);
}

/**
 * Get latest prices of cryptocurrencies
 *
 * @param {string[]} $filterCoins List of coins to filter
 * @returns {Promise<any[]>} Response data from api
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
 * @returns {Promise<any>} Response data from api
 */
async function request($uri, $params = {}) {
  if (!KEY) {
    throw new Error("COINAPI_KEY is not set");
  }

  // Send request via axios helper
  const result = await axiosRequest({
    method: "get",
    url: URL + $uri,
    headers: {
      "X-CoinAPI-Key": KEY,
    },
    params: $params,
  });

  // Validate response data
  if (!result?.length) {
    throw new Error("Empty response data");
  }

  return result;
}

/**
 * Processes a list of cryptocurrency data from CoinAPI
 *
 * @param {any[]} $list - List of cryptocurrencies.
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
      const date = dayjs(item.data_quote_end || item.data_end || undefined);

      return {
        source: PLATFORM.toLowerCase(),
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
