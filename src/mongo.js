"use strict";

import { MongoClient } from "mongodb";

let mongoConnection;

/**
 * Connect to mongodb
 * @param {string} uri Mongo URI
 * @returns {Promise<void>}
 */
async function connectToMongoDB(uri) {
  mongoConnection = new MongoClient(uri);

  await mongoConnection.connect();
}

/**
 * Close MongoDB connection
 * @returns {Promise<void>}
 */
async function closeMongoDB() {
  if (mongoConnection !== undefined) {
    await mongoConnection.close();
  }
}

export { connectToMongoDB, closeMongoDB, mongoConnection };
