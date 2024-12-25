"use strict";

import path from "node:path";
import pg from "pg";

/**
 * Open PostgreSQL database
 * @param {string} uri Database URI
 * @param {boolean} isCreate Is create database?
 * @returns {Promise<pg.Client>} PostgreSQL database instance
 */
export async function openPostgreSQL(uri, isCreate) {
  if (isCreate === true) {
    const client = new pg.Client({
      connectionString: path.dirname(uri),
    });

    try {
      const dbName = path.basename(uri);

      await client.connect();

      const res = await client.query(
        `SELECT 1 FROM pg_database WHERE datname = '${dbName}';`
      );

      if (res.rows.length === 0) {
        await client.query(`CREATE DATABASE "${dbName}";`);
      }
    } catch (error) {
      if (client !== undefined) {
        await client.end();
      }

      throw error;
    }
  }

  const source = new pg.Client({
    connectionString: uri,
  });

  await source.connect();

  return source;
}

/**
 * Close PostgreSQL database
 * @param {pg.Client} source PostgreSQL database instance
 * @returns {Promise<void>}
 */
export async function closePostgreSQL(source) {
  await source.end();
}
