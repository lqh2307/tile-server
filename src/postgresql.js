"use strict";

import pg from "pg";

/**
 * Open PostgreSQL database
 * @param {string} uri Database URI
 * @returns {Promise<pg.Client>} PostgreSQL database instance
 */
export async function openPostgreSQL(uri) {
  return new pg.Client({
    connectionString: uri,
  });
}

/**
 * Close PostgreSQL database
 * @param {pg.Client} source PostgreSQL database instance
 * @returns {Promise<void>}
 */
export async function closePostgreSQL(source) {
  await source.end();
}
