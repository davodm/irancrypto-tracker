import { MongoClient } from "mongodb";

let db;

/**
 * Connect to the MongoDB database
 * @returns {Promise<void>}
 */
export async function connectToMongoDB() {
  const client = new MongoClient(process.env.MONGO_URI, {
    useNewUrlParser: true,
  });
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
      { status: 1, slug: "wallex" },
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
