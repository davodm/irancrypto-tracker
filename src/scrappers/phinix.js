// They are closed right since May 14, 2022
import dayjs from "dayjs";
import num from "../lib/num.js";
import { axiosRequest } from "../lib/request.js";

const PLATFORM = "Okex";
const URL = "https://api.phinix.ir/v1/";

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
  const data = await request("markets", {});
  if (!data.symbols || Object.keys(data.symbols).length === 0) {
    throw new Error("Response data is empty");
  }
  return processList(data.symbols, $filterCoins);
}

/**
 * Send request to Phinix API
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

  // Validate response success
  if (!result?.success) {
    throw new Error(`Response is not successful due to ${result?.message}`);
  }

  // Validate response data
  if (!result || !result.result) {
    throw new Error("Invalid response data");
  }

  return result.result;
}

/**
 * Process the list of cryptocurrencies
 *
 * @param {object[]} $list List of cryptocurrencies
 * @param {string[]} $coinsFilter List of coins to filter
 * @returns {object[]} Processed list of cryptocurrencies
 */
function processList($list, $coinsFilter = []) {
  return Object.values($list)
    .filter((data) => {
      // Check it's in IRT
      if (data?.quoteAsset.toUpperCase() !== "TMN") return false;
      // Check price exists
      if (!data?.stats?.lastPrice || isNaN(data?.stats?.lastPrice))
        return false;
      // Check if the coin list is empty or includes the coin filter list
      return (
        $coinsFilter.length === 0 ||
        $coinsFilter.includes(data.baseAsset.toUpperCase())
      );
    })
    .map((data) => {
      // Handle last update with moment.js
      const date = dayjs();

      // Initialize the transformed object
      return {
        currency: "IRR",
        symbol: data.baseAsset.toUpperCase(),
        // * 10 to convert to IRR
        price:
          num(data.stats.lastPrice, {
            multiply: 10,
            decimalPlaces: 8,
          }) || 0,
        // * 10 to convert to IRR
        volume_1d: isNaN(data.stats["24h_quoteVolume"])
          ? 0
          : num(data.stats["24h_quoteVolume"], {
              multiply: 10,
              roundUp: true,
            }) || 0,
        coin_volume_1d: isNaN(data.stats["24h_volume"])
          ? 0
          : num(data.stats["24h_volume"]) || 0,
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
