import dayjs from "dayjs";
import num from "../../runtime/js/num.js";
import { axiosRequest } from "../../runtime/js/request.js";

const PLATFORM = "BitMax"; // Should be the same as the filename without .js
const URL = "https://api.bitmax.ir/";

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
  const data = await request("watcher/price/alternative", {});
  if (!data || typeof data !== "object" || Object.keys(data).length === 0) {
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
  if (!result?.message) {
    throw new Error("Invalid response data");
  }

  return result.message;
}

/**
 * Process the list of cryptocurrencies
 *
 * @param {object} $data Object of cryptocurrencies with symbol as key
 * @param {string[]} $coinsFilter List of coins to filter
 * @returns {object[]} Processed list of cryptocurrencies
 */
function processList($data, $coinsFilter = []) {
  // Find USDT Price first to calculate Vols
  const usdt = priceUSDT($data);

  return Object.entries($data)
    .filter(([symbol, data]) => {
      // Check price exists
      if (!data?.price_in_irt) return false;
      // Check if the coin list is empty or includes the coin filter list
      return (
        $coinsFilter.length === 0 ||
        $coinsFilter.includes(symbol.toUpperCase())
      );
    })
    .map(([symbol, data]) => {
      const date = dayjs();

      // Initialize the transformed object
      return {
        currency: "IRR",
        symbol: symbol.toUpperCase(),
        // * 10 to convert to IRR (price_in_irt is in Toman)
        price:
          num(data.price_in_irt, { decimalPlaces: 8, multiply: 10 }) || 0,
        // volume_24h is in USD, convert to IRR using USDT price
        volume_1d: num(data.volume_24h, { multiply: usdt, roundUp: true }) || 0,
        // volume_24h divided by price_in_usd gives coin volume
        coin_volume_1d:
          data.price_in_usd > 0
            ? num(data.volume_24h, { divide: data.price_in_usd }) || 0
            : 0,
        change_1d: num(data.change, { decimalPlaces: 2 }),
        change_7d: num(data.change_7d, { decimalPlaces: 2 }),
        // market_cap is in USD, convert to IRR using USDT price
        market_cap:
          num(data.market_cap, { multiply: usdt, roundUp: true }) || 0,
        last_update: {
          date: date.toISOString(),
          timestamp: date.unix(),
          moment: date,
        },
      };
    });
}

// Find USDT Price separately
function priceUSDT($data) {
  const usdt = $data?.USDT;
  if (!usdt?.price_in_irt) return 0;
  // * 10 to convert to IRR (price_in_irt is in Toman)
  const price =
    num(usdt.price_in_irt, { decimalPlaces: 8, multiply: 10 }) || 0;

  return typeof price?.toNumber === "function" ? price.toNumber() : price;
}
