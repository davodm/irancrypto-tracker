import * as db from "./lib/mongodb.js";
import moment from "moment";
import { logError, logInfo } from "./lib/logger.js";
import { captureError } from "./lib/sentry.js";
import { toMongoNumber } from "./lib/utils.js";

export default async function main() {
  const exchanges = await db.getExchanges();
  const coins = await db.getCoins();
  let stats = {
    insert: 0,
    sources: [],
    discovered: 0,
    sourcesEach: {},
  };
  let data = [];

  // Collect promises for scraping operations
  const scrapePromises = exchanges.map((exchange) =>
    (async () => {
      try {
        // Calc the processing time
        const start = moment();
        logInfo(`Processing ${exchange.slug} exchange started`);
        // Find scrapper exists for the exchange
        const scrapper = await import(
          `./scrappers/${exchange.slug.toLowerCase()}.js`
        );
        // Exchange own supported coins only for qureying
        const supportedCoins = exchange?.support || [];

        // Scrape the exchange through the modules
        const result = await scrapper.scrape(
          scrapper.COIN_USE === "own" ? supportedCoins : coins
        );

        // Calc the processing time
        const end = moment();
        logInfo(
          `Processing ${exchange.slug} exchange finished in ${end.diff(
            start,
            "seconds"
          )}s`
        );

        return {
          exchangeSlug: exchange.slug,
          result,
        };
      } catch (error) {
        logError(error);
        captureError(error);
        return {
          exchangeSlug: exchange.slug,
          result: [],
        };
      }
    })()
  );

  // Wait for all scraping operations to complete
  const scrapeResults = await Promise.all(scrapePromises);

  // Process the collected results
  for (const { exchangeSlug, result } of scrapeResults) {
    if (result && result.length) {
      // Add discovered source to the list
      stats.sources.push(exchangeSlug);
      stats.sourcesEach[exchangeSlug] = result.length;
      // Add count of discovered items
      stats.discovered += result.length;
      // Add discovered items to the list
      data = data.concat(result);
    }
  }

  logInfo(
    `Discovered ${stats.discovered} items from ${stats.sources.length} sources`
  );

  try {
    // Map to filter and make ready the list data
    data = data
      .filter((d) => {
        // Check if the price is available
        if (!d?.price || d?.price <= 0) return false;
        // Check if the volume is available
        if (!d?.volume_1d || d?.volume_1d <= 0) return false;
        // Check if source name is valid
        if (!d?.source) return false;
        // Check symbol is in our list
        return coins.includes(d.symbol.toUpperCase());
      })
      .map((d) => {
        // Prepare data for mongoDB
        const item = {
          symbol: `${d.symbol.toUpperCase()}-${d.currency.toUpperCase()}`,
          // Number should be ready for storing
          price: toMongoNumber(d.price),
          volume_currency: toMongoNumber(d.volume_1d),
          source: d.source,
        };
        // Coin volume
        if (d?.coin_volume_1d) {
          item["volume"] = toMongoNumber(d.coin_volume_1d);
        }
        // Change percent
        if (d?.change_1d) {
          item["change_1d"] = toMongoNumber(d.change_1d);
        }
        if (d?.change_7d) {
          item["change_7d"] = toMongoNumber(d.change_7d);
        }
        // Market Cap
        if (d?.market_cap) {
          item["cap"] = toMongoNumber(d.market_cap);
        }
        // Circulating Supply
        if (d?.supply) {
          item["supply"] = toMongoNumber(d.supply);
        }
        // Max Supply
        if (d?.max_supply) {
          item["max_supply"] = toMongoNumber(d.max_supply);
        }
        // Last update
        if (d?.last_update?.moment) {
          // Convert moment to Date object
          item["time"] = d.last_update.moment.toDate();
        } else if (d?.last_update?.date) {
          // Convert date string to Date object
          item["time"] = new Date(d.last_update.date);
        } else if (
          d?.last_update?.timestamp &&
          !isNaN(d.last_update.timestamp)
        ) {
          // Convert timestamp to Date object
          item["time"] = new Date(d.last_update.timestamp * 1000);
        } else {
          // Fallback to current time if no timestamp is provided
          item["time"] = new Date();
        }

        return item;
      });

    logInfo(`Filtered ${data.length} items to insert to the database`);
    stats.insert = data.length;

    // Insert the data to the database
    if (data.length) {
      const result = await db.insertPrices("archive", data);
      logInfo(`Inserted ${result.insertedCount} items to the database`);
    }
    logInfo(`Stats: ${JSON.stringify(stats)}`);

    if (stats?.insert) {
      // Update views for different reasons
      // Exchange Market
      await db.exchangesMarket();
      // Iran Market
      await db.IranMarket();
      logInfo(`Views for exchanges and Iran market are ready`);

      // Recaps
      await db.recapCoin(7, "IRR");
      await db.recapCoin(30, "IRR");
      // Exchange recap
      await db.recapExchange(7);
      await db.recapExchange(30);

      logInfo(`Recap view for exchanges are ready`);
    }
  } catch (error) {
    logError(error);
    captureError(error);
    throw error; // Re-throw to allow caller to handle
  } finally {
    // Close MongoDB connection if needed (optional, connection is reused)
    // await db.closeConnection();
  }
}
