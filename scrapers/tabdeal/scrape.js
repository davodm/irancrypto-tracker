import dayjs from "dayjs";
import num from "../../runtime/js/num.js";
import { axiosRequest } from "../../runtime/js/request.js";

const PLATFORM = "Tabdeal";
const URL = "https://api-web.tabdeal.org/r/plots/";

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
 * @returns {Promise<any[]>} Response data from api
 */
export async function getLatest($filterCoins = []) {
  // Should be exactly with last slash
  const data = await request("currency_prices", {
    limit: 1000,
  });
  if (!data?.length) {
    throw new Error("Response data is empty");
  }
  return processList(data, $filterCoins);
}

/**
 * Send request to TabDeal API
 *
 * @param {string} $uri URI of the endpoint
 * @param {object} $params object of query parameters
 * @returns {Promise<any>} Response data from api
 */
async function request($uri, $params = {}) {
  // Send request via axios helper
  const result = await axiosRequest({
    method: "get",
    url: URL + $uri,
    params: $params,
    useProxy: true,
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
 * @param {any[]} $list List of cryptocurrencies
 * @param {string[]} $coinsFilter List of coins to filter
 * @returns {object[]} Processed list of cryptocurrencies
 */
function processList($list, $coinsFilter = []) {
  // Find USDT Price first to calculate Vol
  const usdt = priceUSDT($list);

  return $list
    .filter((data) => {
      // Check if the currency is IRR
      if (!data?.markets?.filter((y) => y.second_currency.symbol === "IRT" && y.price).length)
        return false;
      // Check if the coin list is empty or includes the coin filter list
      return $coinsFilter.length === 0 || $coinsFilter.includes(data.symbol.toUpperCase());
    })
    .map((data) => {
      const market = data.markets.filter((market) => market.second_currency.symbol === "IRT")[0];
      const date = dayjs();

      // Initialize the transformed object
      return {
        currency: "IRR",
        symbol: data.symbol.toUpperCase(),
        // * 10 to convert to IRR
        price: num(market.price, { decimalPlaces: 8, multiply: 10 }) || 0,
        // Convert usdt equal volume to IRR
        volume_1d: num(data.usdt_volume, { multiply: usdt, roundUp: true }) || 0,
        coin_volume_1d: num(data.volume) || 0,
        change_1d: num(data.change_percent, { decimalPlaces: 2 }),
        last_update: {
          date: date.toISOString(),
          timestamp: date.unix(),
          moment: date,
        },
      };
    });
}

// Find USDT Price separately
function priceUSDT($list) {
  let item = $list.filter((item) => item?.symbol === "USDT");
  if (!item.length) return 0;
  item = item[0];
  item = item.markets.filter((market) => market?.second_currency?.symbol === "IRT");
  if (!item.length) return 0;
  // * 10 to convert to IRR
  const price = num(item[0].price, { decimalPlaces: 8, multiply: 10 });

  return price || 0;
}
