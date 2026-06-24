import dayjs from "dayjs";
import num from "../lib/num.js";
import { axiosRequest } from "../lib/request.js";

const PLATFORM = "Huluex";
const URL = "https://api.huluex.com/api/";

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
  const data = await request("market/getCoinsPriceV3", {
    withGate: true,
    version: 4,
  });
  if (!data?.length) {
    throw new Error("Response data is empty");
  }
  return processList(data, $filterCoins);
}

/**
 * Send request to Huluex API
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
  if (!result?.data) {
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
  // Get USDT price to calculate Assets
  const usdt = priceUSDT($list);

  return $list
    .filter((data) => {
      // Trades are on USDT
      // Check price exists
      if (!data?.sellPrice && !data?.buyPrice) return false;
      // Check if the coin list is empty or includes the coin filter list
      return (
        $coinsFilter.length === 0 ||
        $coinsFilter.includes(data.symbol.toUpperCase())
      );
    })
    .map((data) => {
      // Handle last update with moment.js
      const date = dayjs();
      let price =
        num(data.sellPrice || data.buyPrice, {
          decimalPlaces: 8,
          multiply: 10,
        }) || 0;

      // Initialize the transformed object
      return {
        currency: "IRR",
        symbol: data.symbol.toUpperCase(),
        // * 10 to convert to IRR
        price: price,
        // * 10 to convert to IRR
        volume_1d:
          num(data.valume || data.volume, { multiply: 10, roundUp: true }) || 0,
        coin_volume_1d:
          num(data.valume || data.volume, {
            divide:
              typeof price?.toNumber === "function" ? price.toNumber() : price,
          }) || 0,
        change_1d: num(data.changePrice, { decimalPlaces: 2 }),
        last_update: {
          date: date.toISOString(),
          timestamp: date.unix(),
          moment: date,
        },
      };
    });
}

function priceUSDT($list) {
  const item = $list.find((data) => data.symbol === "USDT" || data.symbol === "IRT");
  if (!item) return 0;
  return item.sellTetherPrice || item.tetherPrice || 0;
}
