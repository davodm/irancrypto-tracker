import { MongoClient } from "mongodb";
import dayjs from "dayjs";
import { durationName } from "./utils.js";

let db;
let client;

/**
 * Ensure database connection is established
 * @returns {Promise<void>}
 */
async function ensureConnection() {
  if (!db || !client) {
    await connectToMongoDB();
  }
}

/**
 * Connect to the MongoDB database
 * @returns {Promise<void>}
 * @throws {Error} - If connection fails
 */
export async function connectToMongoDB() {
  if (client && db) {
    return; // Already connected
  }

  const uri = process.env.MONGO_URI;
  if (!uri) {
    throw new Error("MONGO_URI environment variable is not set");
  }

  const dbName = process.env.MONGO_DBNAME;
  if (!dbName) {
    throw new Error("MONGO_DBNAME environment variable is not set");
  }

  try {
    client = new MongoClient(uri);
    await client.connect();
    db = client.db(dbName);
  } catch (error) {
    client = null;
    db = null;
    throw new Error(`Failed to connect to MongoDB: ${error.message}`);
  }
}

/**
 * Close the MongoDB connection
 * @returns {Promise<void>}
 */
export async function closeConnection() {
  if (client) {
    await client.close();
    client = null;
    db = null;
  }
}

/**
 * Insert prices data into archive collection
 * @param {string} collectionName - Name of the collection
 * @param {object[]} dataList - List of data to insert
 * @returns {Promise<import('mongodb').InsertManyResult>}
 */
export async function insertPrices(collectionName, dataList) {
  await ensureConnection();
  const collection = db.collection(collectionName);
  return await collection.insertMany(dataList);
}

/**
 * Update a single document in a collection
 * @param {string} collectionName - Name of the collection
 * @param {object} findQuery - Query to find the document
 * @param {object} updateQuery - Update operations
 * @returns {Promise<import('mongodb').UpdateResult>}
 */
export async function updateData(collectionName, findQuery, updateQuery) {
  await ensureConnection();
  const collection = db.collection(collectionName);
  return await collection.updateOne(findQuery, updateQuery);
}

/**
 * Get all active exchanges from the database
 * @returns {Promise<Array<{slug: string, _id: any, support: any[]}>>} - Array of active exchanges
 */
export async function getExchanges() {
  await ensureConnection();
  const collection = db.collection("exchanges");
  return await collection
    .find(
      { status: 1 },
      {
        projection: {
          slug: 1,
          _id: 1,
          support: 1,
        },
      }
    )
    .toArray();
}

/**
 * Get all active coins from the database
 * @returns {Promise<string[]>} - Array of active coin symbols
 */
export async function getCoins() {
  await ensureConnection();
  const collection = db.collection("coins");
  const result = await collection
    .find(
      { status: 1 },
      {
        projection: {
          symbol: 1,
        },
      }
    )
    .toArray();
  return result.map((coin) => coin.symbol);
}

/**
 * Generate a recap view based on currency
 * @param {number} duration - Duration in days
 * @param {string} fiat - Fiat currency
 * @returns {Promise<Array>} - Array of aggregation results
 */
export async function recapCoin(duration, fiat) {
  await ensureConnection();

  // Define duration name function
  const type = durationName(duration);

  // Calculate the start date based on the duration (adjusting date format as required)
  const startDate = dayjs().subtract(duration, "days").startOf("day");

  // Build the aggregation pipeline
  const pipeline = [
    {
      $match: {
        symbol: { $regex: `^.*-${fiat}$` },
        time: { $gte: startDate.toDate() },
      },
    },
    {
      $group: {
        _id: {
          symbol: "$symbol",
          source: "$source",
        },
        doc: { $first: "$$ROOT" },
      },
    },
    {
      $replaceRoot: { newRoot: "$doc" },
    },
    {
      $group: {
        _id: {
          symbol: "$symbol",
          source: "$source",
        },
        max_time: { $max: "$time" },
        min_price: { $min: "$price" },
        max_price: { $max: "$price" },
        average_price: { $avg: "$price" },
        total_volume_coin: { $sum: "$volume" },
        total_volume_currency: { $sum: "$volume_currency" },
      },
    },
    {
      $group: {
        _id: "$_id.symbol",
        duration: { $sum: 1 },
        last_update: { $max: "$max_time" },
        data: {
          $push: {
            source: "$_id.source",
            total_volume_coin: "$total_volume_coin",
            total_volume_currency: "$total_volume_currency",
            min_price: "$min_price",
            max_price: "$max_price",
            average_price: "$average_price",
          },
        },
      },
    },
    {
      $project: {
        _id: 0,
        symbol: "$_id",
        type: type,
        duration: 1,
        last_update: 1,
        price_avg: { $avg: "$data.average_price" },
        price_min: { $min: "$data.min_price" },
        price_max: { $max: "$data.max_price" },
        volume_coin: {
          $sum: {
            $map: {
              input: "$data",
              as: "recap",
              in: "$$recap.total_volume_coin",
            },
          },
        },
        volume: {
          $sum: {
            $map: {
              input: "$data",
              as: "recap",
              in: "$$recap.total_volume_coin",
            },
          },
        },
      },
    },
    // Merge section
    {
      $merge: {
        into: "recap_coin",
        on: ["symbol", "type"],
        whenMatched: "replace",
        whenNotMatched: "insert",
      },
    },
  ];

  // Execute the aggregation
  const aggregation = await db.collection("archive").aggregate(pipeline);
  return await aggregation.toArray();
}

/**
 * Generate a recap view based on exchange
 * @param {number} duration - Duration in days
 * @returns {Promise<Array>} - Array of aggregation results
 */
export async function recapExchange(duration) {
  await ensureConnection();

  // Define duration name function
  const type = durationName(duration);

  // Calculate the start date based on the duration (adjusting date format as required)
  const startDate = dayjs().subtract(duration, "days").startOf("day");

  // Build the aggregation pipeline
  const pipeline = [
    {
      $match: {
        source: { $nin: ["CoinMarketCap", "CoinGecko"] },
        time: { $gte: startDate.toDate() },
      },
    },
    {
      $group: {
        _id: {
          source: "$source",
          day: {
            $dateToString: { format: "%Y-%m-%d", date: "$time" },
          },
        },
        volume: { $max: "$volume_currency" },
        max_time: { $max: "$time" },
      },
    },
    {
      $group: {
        _id: "$_id.source",
        duration: { $sum: 1 },
        last_update: { $max: "$max_time" },
        volume: { $sum: "$volume" },
        volume_min: { $min: "$volume" },
        volume_max: { $max: "$volume" },
      },
    },
    {
      $project: {
        _id: 0,
        source: "$_id",
        type: type,
        duration: 1,
        last_update: 1,
        volume: 1,
        volume_min: 1,
        volume_max: 1,
      },
    },
    // Merge section
    {
      $merge: {
        into: "recap_exchange",
        on: ["source", "type"],
        whenMatched: "replace",
        whenNotMatched: "insert",
      },
    },
  ];

  // Execute the aggregation
  const aggregation = await db.collection("archive").aggregate(pipeline);
  return await aggregation.toArray();
}

/**
 * Generate a view for each coin price on Iran's market
 * @returns {Promise<Array>} - Array of aggregation results
 */
export async function IranMarket() {
  await ensureConnection();

  const pipeline = [
    {
      $lookup: {
        from: "exchanges",
        localField: "source",
        foreignField: "slug",
        as: "matchedSource",
      },
    },
    {
      $match: {
        symbol: { $regex: "^.*-IRR$" },
        time: { $gte: new Date(new Date().setHours(0, 0, 0, 0)) },
        matchedSource: { $ne: [] },
      },
    },
    {
      $sort: {
        time: -1,
      },
    },
    {
      $group: {
        _id: ["$source", "$symbol"],
        doc: { $first: "$$ROOT" },
      },
    },
    {
      $replaceRoot: { newRoot: "$doc" },
    },
    {
      $group: {
        _id: "$symbol",
        symbol: { $last: "$symbol" },
        price: { $avg: "$price" },
        price_min: { $min: "$price" },
        price_max: { $max: "$price" },
        volume: { $sum: "$volume" },
        volume_currency: { $sum: "$volume_currency" },
        change_1d: { $avg: "$change_1d" },
        change_7d: { $avg: "$change_7d" },
        time: { $max: "$time" },
      },
    },
    // Merge section
    {
      $merge: {
        into: "iranmarket",
        on: ["_id"],
        whenMatched: "replace",
        whenNotMatched: "insert",
      },
    },
  ];

  // Execute the aggregation
  const aggregation = await db.collection("archive").aggregate(pipeline);
  return await aggregation.toArray();
}

/**
 * Generate a view for exchange market data
 * @returns {Promise<Array>} - Array of aggregation results
 */
export async function exchangesMarket() {
  await ensureConnection();

  const pipeline = [
    {
      $lookup: {
        from: "exchanges",
        localField: "source",
        foreignField: "slug",
        as: "matchedSource",
      },
    },
    {
      $match: {
        symbol: { $regex: "^.*-IRR$" },
        time: { $gte: new Date(new Date().setHours(0, 0, 0, 0)) },
        matchedSource: { $ne: [] },
      },
    },
    {
      $sort: {
        time: -1,
      },
    },
    {
      $group: {
        _id: ["$source", "$symbol"],
        doc: { $first: "$$ROOT" },
      },
    },
    {
      $replaceRoot: { newRoot: "$doc" },
    },
    {
      $group: {
        _id: "$source",
        data: {
          $push: {
            symbol: "$symbol",
            price: "$price",
            volume: "$volume",
            volume_currency: "$volume_currency",
            change_1d: "$change_1d",
            change_7d: "$change_7d",
            time: "$time",
          },
        },
      },
    },
    // Merge section
    {
      $merge: {
        into: "exchangemarket",
        on: ["_id"],
        whenMatched: "replace",
        whenNotMatched: "insert",
      },
    },
  ];

  // Execute the aggregation
  const aggregation = await db.collection("archive").aggregate(pipeline);
  return await aggregation.toArray();
}
