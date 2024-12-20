"use strict";

import { MongoClient } from "mongodb";

/**
 * Open MongoDB connection
 * @param {string} uri MongoDB connection string
 * @param {string} dbName Database name
 * @returns {Promise<any>} MongoDB database instance
 */
export async function openMongoDB(uri, dbName) {
  const client = new MongoClient(uri, {
    useUnifiedTopology: true,
  });

  await client.connect();

  return client.db(dbName);
}

/**
 * Close MongoDB connection
 * @param {MongoClient} client MongoDB client instance
 * @returns {Promise<void>}
 */
export async function closeMongoDB(client) {
  await client.close();
}
