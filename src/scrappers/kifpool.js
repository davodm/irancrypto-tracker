import dayjs from "dayjs";
import num from "../lib/num.js";
import { axiosRequest } from "../lib/request.js";

const PLATFORM = "KifPool";
const URL = "https://api.kifpool.app/api/";

// Define for automation which coins filter list is gonna be used
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
 * @returns {Promise<object[]>} Response data from api
 */
export async function getLatest($filterCoins = []) {
  let offset = 0;
  const limit = 200;
  let allData = [];
  let hasMore = true;

  while (hasMore) {
    const response = await request("spot/price/paginated", {
      offset,
      limit,
    });

    if (!response?.data || !Array.isArray(response.data)) {
      break;
    }

    allData.push(...response.data);

    const total = response.meta?.total || 0;
    offset += limit;

    // Stop if we got fewer items than limit or reached total count
    if (response.data.length < limit || offset >= total) {
      hasMore = false;
    }
  }

  if (!allData.length) {
    throw new Error("Response data is empty");
  }

  return processList(allData, $filterCoins);
}

/**
 * Send request to KifPool API
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
  return $list
    .filter((data) => {
      // Check if price exists
      if (!data?.priceSellIRT && !data?.priceBuyIRT) return false;
      // Check if the coin list is empty or includes the coin filter list
      return (
        $coinsFilter.length === 0 ||
        $coinsFilter.includes(data.symbol.toUpperCase())
      );
    })
    .map((data) => {
      // Handle last update with moment.js
      const date = data.updatedAt ? dayjs(data.updatedAt) : dayjs();

      // Use the exchange's selling price (user's buy price) as standard, fallback to buy price
      const priceIRT = data.priceSellIRT || data.priceBuyIRT || 0;

      // Convert price from Tomans (IRT) to Iranian Rials (IRR) by * 10
      const price = num(priceIRT, { decimalPlaces: 8, multiply: 10 }) || 0;

      // Convert 24h volume from IRT to IRR by * 10
      const volume_1d = num(data.volume, { roundUp: true, multiply: 10 }) || 0;

      // Calculate coin volume = volume (IRT) / price (IRT)
      const coin_volume_1d = priceIRT > 0 ? num(data.volume, { divide: priceIRT }) : 0;

      // Map 24h change
      const change_1d = num(data.priceChangePercent, { decimalPlaces: 2 }) || 0;

      // Initialize the transformed object
      return {
        currency: "IRR",
        symbol: data.symbol.toUpperCase(),
        price,
        volume_1d,
        coin_volume_1d,
        change_1d,
        last_update: {
          date: date.toISOString(),
          timestamp: date.unix(),
          moment: date,
        },
      };
    });
}
