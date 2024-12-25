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
    const tmpClient = new pg.Client({
      connectionString: process.env.POSTGRESQL_BASE_URI,
    });

    try {
      const dbName = path.basename(uri);

      await tmpClient.connect();

      const res = await tmpClient.query(
        `SELECT FROM pg_database WHERE datname = "${dbName}";`
      );

      if (res.rows.length === 0) {
        await tmpClient.query(`CREATE DATABASE "${dbName}";`);
      }
    } catch (error) {
      if (tmpClient !== undefined) {
        await tmpClient.end();
      }

      throw error;
    }
  }

  const client = new pg.Client({
    connectionString: uri,
  });

  await source.connect();

  return client;
}

/**
 * Close PostgreSQL database
 * @param {pg.Client} source PostgreSQL database instance
 * @returns {Promise<void>}
 */
export async function closePostgreSQL(source) {
  await source.end();
}
