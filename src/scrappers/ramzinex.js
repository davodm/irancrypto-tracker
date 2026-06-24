import dayjs from "dayjs";
import num from "../lib/num.js";
import { axiosRequest } from "../lib/request.js";

const PLATFORM = "Ramzinex";
const URL = "https://publicapi.ramzinex.com/exchange/api/v1.0/";

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
  const data = await request("exchange/pairs", {});
  return processList(data, $filterCoins);
}

/**
 * Send request to Ramzinex API
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
  if (!result?.data || !result.data.length) {
    throw new Error("Invalid response data");
  }

  return result.data;
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
      if (
        !data?.quote_currency_symbol?.en ||
        data?.quote_currency_symbol?.en.toUpperCase() !== "IRR"
      )
        return false;
      // Check price exists
      if (!data?.sell) return false;
      // Check if the coin list is empty or includes the coin filter list
      return (
        $coinsFilter.length === 0 ||
        $coinsFilter.includes(data.base_currency_symbol.en.toUpperCase())
      );
    })
    .map((data) => {
      // Handle last update with moment.js
      const date = dayjs();

      // Initialize the transformed object
      return {
        currency: "IRR",
        symbol: data.base_currency_symbol.en.toUpperCase(),
        price: num(data.sell, { decimalPlaces: 8 }) || 0,
        volume_1d:
          num(data.financial.last24h.quote_volume, { roundUp: true }) || 0,
        coin_volume_1d: num(data.financial.last24h.base_volume) || 0,
        change_1d:
          num(data.financial.last24h.change_percent, { decimalPlaces: 2 }) || 0,
        last_update: {
          date: date.toISOString(),
          timestamp: date.unix(),
          moment: date,
        },
      };
    });
}
