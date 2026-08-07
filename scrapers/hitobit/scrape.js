import dayjs from "dayjs";
import num from "../../runtime/js/num.js";
import { axiosRequest } from "../../runtime/js/request.js";

const PLATFORM = "Hitobit";
const URL = "https://hitobit.com/hapi/exchange/v1/public/";

// Define for automation to which coins to filter are gonna be used
export const COIN_USE = "all"; // own, all, none

/**
 * Scrape to use in automation
 * @param {string[]} $coins - List of coins to filter
 */
export async function scrape($coins = []) {
  // Get the list of prices
  const data = await getLatest($coins);
  // Sign the data with platform name
  data.forEach((d) => {
    d.source = PLATFORM.toLowerCase();
  });

  return data;
}

/**
 * Get latest prices of cryptocurrencies
 *
 * @param {string[]} $filterCoins List of coins to filter
 * @returns {Promise<object>} Response data from api
 */
export async function getLatest($filterCoins = []) {
  // Should be exactly with last slash
  const data = await request("alltickers/24hr", {});
  if (!data?.length) {
    throw new Error("Response data is empty");
  }
  return processList(data, $filterCoins);
}

/**
 * Send request to Hitobit API
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

  // Validate response error
  if (result?.error) {
    throw new Error(`Response failed due to ${result?.message}`);
  }

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
      // Check it's in IRT quote
      if (data?.quoteCurrencySymbol !== "IRT") return false;
      // Check price exists
      if (!data?.lastPrice) return false;
      // Check if the coin list is empty or includes the coin filter list
      return (
        $coinsFilter.length === 0 ||
        $coinsFilter.includes(data.baseCurrencySymbol.toUpperCase())
      );
    })
    .map((data) => {
      const date = dayjs(data?.lastMarketInfoChangeDate || undefined);

      // Initialize the transformed object
      return {
        currency: "IRR",
        symbol: data.baseCurrencySymbol.toUpperCase(),
        // * 10 to convert to IRR
        price: num(data.lastPrice, { decimalPlaces: 8, multiply: 10 }) || 0,
        // * 10 to convert to IRR
        volume_1d: num(data.quoteVolume, { multiply: 10, roundUp: true }) || 0,
        coin_volume_1d: num(data.baseVolume) || 0,
        change_1d: num(data.priceChangePercent, { decimalPlaces: 2 }),
        last_update: {
          date: date.toISOString(),
          timestamp: date.unix(),
          moment: date,
        },
      };
    });
}
