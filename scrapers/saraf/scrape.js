import dayjs from "dayjs";
import num from "../../runtime/js/num.js";
import { axiosRequest } from "../../runtime/js/request.js";

const PLATFORM = "Saraf";
const URL = "https://api.saraf.app/v3/prices/crypto";

// Define for automation which coins filter list is gonna be used
export const COIN_USE = "all"; // own, all, none

/**
 * Scrape to use in automation
 * @param {string[]} $coins - List of coins to filter
 */
export async function scrape($coins = []) {
  return await getLatest($coins);
}

/**
 * Get latest prices of cryptocurrencies
 *
 * @param {string[]} $filterCoins List of coins to filter
 * @returns {Promise<object[]>} Response data from api
 */
export async function getLatest($filterCoins = []) {
  const items = await request();
  if (!items?.length) {
    throw new Error("Response data is empty");
  }
  return processList(items, $filterCoins);
}

/**
 * Send request to Saraf API
 *
 * @returns {Promise<object[]>} Response data from api
 */
async function request() {
  // Send request via axios helper
  const result = await axiosRequest({
    method: "get",
    url: URL,
  });

  // Validate response data
  if (!result?.price?.Items) {
    throw new Error("Invalid response data");
  }

  return Object.values(result.price.Items);
}

/**
 * Process the list of cryptocurrencies
 *
 * @param {any[]} $list List of cryptocurrencies
 * @param {string[]} $coinsFilter List of coins to filter
 * @returns {object[]} Processed list of cryptocurrencies
 */
function processList($list, $coinsFilter = []) {
  return $list
    .filter((item) => {
      // Make sure the asset is crypto
      if (item?.assetType?.toUpperCase() !== "CRYPTO") return false;
      // Check if price exists
      if (!item?.p) return false;
      // Check if the coin list is empty or includes the coin filter list
      return $coinsFilter.length === 0 || $coinsFilter.includes(item.s.toUpperCase());
    })
    .map((item) => {
      // Parse last update (ut is in milliseconds)
      const date = item.ut ? dayjs(Number(item.ut)) : dayjs();

      // Convert price from Tomans (IRT) to Iranian Rials (IRR) by * 10
      const priceIRT = Number(num(item.p)) || 0;
      const price = num(item.p, { decimalPlaces: 8, multiply: 10 }) || 0;

      // Convert volume (mc) from IRT to IRR by * 10
      const volume_1d = num(item.mc, { roundUp: true, multiply: 10 }) || 0;

      // Calculate coin volume = volume (IRT) / price (IRT)
      const coin_volume_1d = priceIRT > 0 ? num(item.mc, { divide: priceIRT }) : 0;

      // Map 24h change
      const change_1d = num(item.c, { decimalPlaces: 2 }) || 0;

      // Initialize the transformed object
      return {
        source: PLATFORM.toLowerCase(),
        currency: "IRR",
        symbol: item.s.toUpperCase(),
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
