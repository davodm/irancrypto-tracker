import dayjs from "dayjs";
import num from "../../runtime/js/num.js";
import { axiosRequest } from "../../runtime/js/request.js";

const PLATFORM = "CoinMarketCap";
const URL = "https://pro-api.coinmarketcap.com/v1/";
const KEYS = process.env.COINMARKETCAP_API_KEY
  ? process.env.COINMARKETCAP_API_KEY.split(",").map((key) => key.trim())
  : [];

// Define for automation to which coins to filter are gonna be used
export const COIN_USE = "all"; // own, all, none

/**
 * Scrape to use in automation
 * @param {string[]} $coins - List of coins to filter
 */
export async function scrape($coins = []) {
  // Get the list of prices
  const data = await getLatest(200, $coins);
  // Sign the data with platform name
  data.forEach((d) => {
    d.source = PLATFORM.toLowerCase();
  });

  return data;
}

/**
 * Get latest prices of cryptocurrencies
 *
 * @param {number} $limit Number of items to return
 * @param {string[]} $filterCoins List of coins to filter
 * @returns {Promise<object>} Response data from api
 */
export async function getLatest($limit = 200, $filterCoins = []) {
  const data = await request("cryptocurrency/listings/latest", {
    start: 1,
    limit: $limit,
    aux: [
      // to Remove unnecessary data
      "max_supply",
      "circulating_supply",
      "total_supply",
      "market_cap_by_total_supply",
      "volume_24h_reported",
      "volume_7d",
      "volume_7d_reported",
      "volume_30d",
      "volume_30d_reported",
      "is_market_cap_included_in_calc",
    ].join(","),
  });
  return processList(data, $filterCoins);
}

/**
 * Get most increased prices of cryptocurrencies over 50K volume
 *
 * @param {number} $limit Number of items to return
 * @param {string[]} $filterCoins List of coins to filter
 * @returns {Promise<object>}
 */
export async function getGainers($limit = 20, $filterCoins = []) {
  const data = await request("cryptocurrency/listings/latest", {
    start: 1,
    limit: $limit,
    sort: "percent_change_24h",
    sort_dir: "desc",
    volume_24h_min: 50000, // Min volume of 50k
  });
  return processList(data, $filterCoins);
}

/**
 * Get most decreased prices of cryptocurrencies over 50K volume
 *
 * @param {number} $limit Number of items to return
 * @param {string[]} $filterCoins List of coins to filter
 * @returns {Promise<object>} Response data from api
 */
export async function getLosers($limit = 20, $filterCoins = []) {
  const data = await request("cryptocurrency/listings/latest", {
    start: 1,
    limit: $limit,
    sort: "percent_change_24h",
    sort_dir: "asc",
    volume_24h_min: 50000, // Min volume of 50k
  });
  return processList(data, $filterCoins);
}

/**
 * Get global metrics of crypto world to store and show as statistics
 *
 * @returns {Promise<object>} Response data from api
 */
export async function getGlobalMetrics() {
  $data = await request("global-metrics/quotes/latest");
  return {
    last_update: {
      date: $data.last_updated,
      timestamp: dayjs($data.last_updated).unix(),
    },
    dominance: {
      btc: $data.btc_dominance,
      eth: $data.eth_dominance,
    },
    quote: $data.quote.USD,
  };
}

/**
 * Send request to CoinMarketCap API
 *
 * @param {string} $uri URI of the endpoint
 * @param {object} $params object of query parameters
 * @returns {Promise<object>} Response data from api
 */
async function request($uri, $params = {}) {
  if (!KEYS || KEYS.length === 0) {
    throw new Error("COINMARKETCAP_API_KEY is not set or empty");
  }
  
  // Send request via axios helper
  const result = await axiosRequest({
    method: "get",
    url: URL + $uri,
    params: $params,
    headers: {
      "X-CMC_PRO_API_KEY": KEYS[Math.floor(Math.random() * KEYS.length)],
    },
  });

  // Validate status
  if (!result?.status || result?.status?.error_code !== 0) {
    throw new Error(
      `Invalid response status: ${
        result?.status?.error_message || result?.status?.error_code
      }`
    );
  }

  // Validate response data
  if (!result?.data) {
    throw new Error("Invalid response data");
  }

  return result.data;
}

/**
 * Process the list of cryptocurrencies from CoinMarketCap API
 *
 * @param {object[]} $list List of cryptocurrencies
 * @param {string[]} $coinsFilter List of coins to filter
 * @returns {object[]} Processed list of cryptocurrencies
 */
function processList($list, $coinsFilter = []) {
  return $list
    .filter((data) => {
      // Check if there is no quote data
      if (!data?.quote?.USD) return false;
      // Check if the coin list is empty or includes the coin filter list
      return (
        $coinsFilter.length === 0 ||
        $coinsFilter.includes(data.symbol.toUpperCase())
      );
    })
    .map((data) => {
      const symbol = data.symbol.toUpperCase();
      const quoteUSD = data.quote.USD;

      // Parse numerical values with fallback to 0
      const price = num(quoteUSD.price, { decimalPlaces: 8 }) || 0;

      const date = dayjs(data.last_updated);

      // Initialize the transformed object
      const transformed = {
        id: data.id,
        currency: "USD",
        name: data.name,
        symbol: symbol,
        price: price,
        volume_1d: num(quoteUSD.volume_24h, { roundUp: true }) || 0,
        change_1h: num(quoteUSD.percent_change_1h, { decimalPlaces: 2 }) || 0,
        change_1d: num(quoteUSD.percent_change_24h, { decimalPlaces: 2 }) || 0,
        change_7d: num(quoteUSD.percent_change_7d, { decimalPlaces: 2 }) || 0,
        market_cap:
          num(quoteUSD.market_cap, { decimalPlaces: 0, roundUp: true }) || 0,
        supply: data.circulating_supply || 0,
        max_supply: num(data.max_supply) || 0,
        total_supply: num(data.total_supply) || 0,
        last_update: {
          date: date.toISOString(),
          timestamp: date.unix(),
          moment: date,
        },
      };

      // Conditional assignment of coin's market cap and volume
      // If isset Directly on Quote -> Coin's based data
      if (data.quote.hasOwnProperty(symbol) && data.quote[symbol]) {
        transformed["coin_market_cap"] =
          num(data.quote[symbol].market_cap) || 0;
        transformed["coin_volume_1d"] = num(data.quote[symbol].volume_24h) || 0;
      } else if (price > 0) {
        // If there is not direct data then calculate based on price
        transformed["coin_market_cap"] =
          num(quoteUSD.market_cap, { divide: price }) || 0;
        transformed["coin_volume_1d"] =
          num(quoteUSD.volume_24h, { divide: price }) || 0;
      }

      return transformed;
    });
}
