import moment from "moment";
import { axiosRequest } from "../lib/request.js";
import num from "../lib/num.js";

const PLATFORM = "Ariomex"; // Should be the same as the filename without .js
const URL =
  "https://data.ariomex.com/exchange_data/markets_details?maxRowsPerPage=200&page=1&resolution=1d&quote=irt";

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
  const data = await request();
  if (!data || !data.length) {
    throw new Error("Response data is empty");
  }
  return processList(data, $filterCoins);
}

/**
 * Send request to Ariomex API
 *
 * @returns {Promise<object[]>} Response data from api
 */
async function request() {
  // Send request via axios helper
  const result = await axiosRequest({
    method: "get",
    url: URL,
  });

  // Validate status
  if (!result?.status || result.status !== "true") {
    throw new Error(
      `Invalid response status (${result.status}): ${result.message}`
    );
  }

  // Validate response data
  if (!result?.result || !Array.isArray(result.result)) {
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
  return $list
    .filter((data) => {
      // Check it's not for test and price exists
      if (!data?.last_price) return false;
      // Check if the coin list is empty or includes the coin filter list
      return (
        $coinsFilter.length === 0 ||
        $coinsFilter.includes(data.base.toUpperCase())
      );
    })
    .map((data) => {
      // Handle last update with moment.js
      const date = moment();

      // Volume is in coin, calculate currency volume = coin_volume * price
      // Then multiply by 10 to convert IRT to IRR
      const coinVolume = num(data.volume) || 0;
      const priceIRT = num(data.last_price) || 0;
      const volumeIRT = coinVolume * priceIRT;

      // Initialize the transformed object
      return {
        currency: "IRR",
        symbol: data.base.toUpperCase(),
        // * 10 to convert IRT to IRR
        price: num(data.last_price, { decimalPlaces: 8, multiply: 10 }) || 0,
        // * 10 to convert IRT to IRR
        volume_1d: num(volumeIRT, { multiply: 10, roundUp: true }) || 0,
        coin_volume_1d: coinVolume,
        change_1d: num(data.change_percentage, { decimalPlaces: 2 }),
        last_update: {
          date: date.toISOString(),
          timestamp: date.unix(),
          moment: date,
        },
      };
    });
}
