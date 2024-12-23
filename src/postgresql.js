"use strict";

import { Client } = from "pg";

/**
 * Open PostgreSQL database
 * @param {string} uri Database URI
 * @returns {Promise<sqlite3.Database>} PostgreSQL database instance
 */
export async function openPostgreSQL(uri) {
  return new Client({
    connectionString: uri,
  });
}

/**
 * Close PostgreSQL database
 * @param {sqlite3.Database} source PostgreSQL database instance
 * @returns {Promise<void>}
 */
export async function closePostgreSQL(source) {
  await source.end();
}
