import { MongoClient } from "mongodb";
import moment from "moment";
import { durationName } from "./utils.js";

let db;

/**
 * Connect to the MongoDB database
 * @returns {Promise<void>}
 */
export async function connectToMongoDB() {
  const client = new MongoClient(process.env.MONGO_URI);
  await client.connect();
  db = client.db(process.env.MONGO_DBNAME);
}

/**
 * Insert prices data into archive collection
 * @param {string} collectionName - Name of the collection
 * @param {object[]} dataList - List of data to insert
 * @returns {Promise<void>}
 */
export async function insertPrices(collectionName, dataList) {
  if (!db) {
    await connectToMongoDB();
  }
  const collection = db.collection(collectionName);
  return await collection.insertMany(dataList);
}

export async function updateData(collectionName, findQuery, updateQuery) {
  if (!db) {
    await connectToMongoDB();
  }
  const collection = db.collection(collectionName);
  return await collection.updateOne(findQuery, updateQuery);
}

/**
 * Get all active exchanges from the database
 * @returns {Promise<Array>} - Array of active exchanges
 */
export async function getExchanges() {
  if (!db) {
    await connectToMongoDB();
  }
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
 * @returns {Promise<Array>} - Array of active coins
 */
export async function getCoins() {
  if (!db) {
    await connectToMongoDB();
  }
  
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
 * @returns {Promise<Void>}
 */
export async function recapCoin(duration, fiat) {
  if (!db) {
    await connectToMongoDB();
  }

  // Define duration name function
  const type = durationName(duration);

  // Calculate the start date based on the duration (adjusting date format as required)
  const startDate = moment().subtract(duration, "days").startOf("day");

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
  return await db.collection("archive").aggregate(pipeline);
}

/**
 * Generate a recap view based on exchange
 * @param {number} duration - Duration in days
 * @returns {Promise<Void>}
 */
export async function recapExchange(duration) {
  if (!db) {
    await connectToMongoDB();
  }

  // Define duration name function
  const type = durationName(duration);

  // Calculate the start date based on the duration (adjusting date format as required)
  const startDate = moment().subtract(duration, "days").startOf("day");

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
  return await db.collection("archive").aggregate(pipeline);
}
