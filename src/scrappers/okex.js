import dayjs from "dayjs";
import num from "../lib/num.js";
import { axiosRequest } from "../lib/request.js";

const PLATFORM = "Okex";
const URL = "https://api.ok-ex.io/oapi/v1/";

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
  const data = await request("market/tickers", {});
  if (!data.tickers && !data?.tickers?.length) {
    throw new Error("Response data is empty");
  }
  return processList(data.tickers, $filterCoins);
}

/**
 * Send request to Okex API
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
  const usdt = priceUSDT($list); // in IRR
  return $list
    .filter((data) => {
      const split = data.symbol.toUpperCase().split("-");
      if (split.length === 2 && !["IRT", "USDT"].includes(split[1]))
        return false;
      // Check price exists
      if (!data?.last) return false;
      // Check if the coin list is empty or includes the coin filter list
      return $coinsFilter.length === 0 || $coinsFilter.includes(split[0]);
    })
    .map((data) => {
      // Handle last update with moment.js - get timestamp
      const date = dayjs.unix(num(data.ts, { divide: 1000 }));
      const split = data.symbol.toUpperCase().split("-");

      // Calculate the change between open and last price in percentage
      const change = num(
        num(Number(data.open_24h) - Number(data.last), {
          decimalPlaces: 8,
        }),
        {
          multiply: 100,
          divide: Number(data.open_24h),
          decimalPlaces: 2,
        }
      );

      // Initialize the transformed object
      return {
        currency: "IRR",
        symbol: split[0],
        // Price is in USDT - Or in IRT one's just *10
        price:
          num(data.last, {
            multiply: split[1] === "IRT" ? 10 : usdt,
            decimalPlaces: 8,
          }) || 0,
        // Volume is in USDT - Or in IRT one's just *1 since volume is in IRR
        volume_1d:
          num(data.vol_24h_pair, {
            multiply: split[1] === "IRT" ? 1 : usdt,
            roundUp: true,
          }) || 0,
        coin_volume_1d: num(data.vol_24h) || 0,
        change_1d: change,
        last_update: {
          date: date.toISOString(),
          timestamp: date.unix(),
          moment: date,
        },
      };
    });
}

function priceUSDT($list) {
  const data = $list.filter((item) => item.symbol === "USDT-IRT");
  // * 10 to convert to IRR
  const price = num(data[0].last || data[0].best_ask, {
    roundUp: true,
    multiply: 10,
  });
  return typeof price?.toNumber === "function" ? price.toNumber() : price;
}
