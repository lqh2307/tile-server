"use strict";

import sqlite3 from "sqlite3";
import path from "node:path";

/**
 * Open SQLite database
 * @param {string} filePath File path
 * @param {number} mode SQLite mode (e.g: sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE | sqlite3.OPEN_READONLY)
 * @param {boolean} wal Use WAL
 * @returns {Promise<sqlite3.Database>}
 */
export async function openSQLite(
  filePath,
  mode = sqlite3.OPEN_READONLY,
  wal = false
) {
  // Create folder if has sqlite3.OPEN_CREATE mode
  if (mode & sqlite3.OPEN_CREATE) {
    await fsPromise.mkdir(path.dirname(filePath), {
      recursive: true,
    });
  }

  // Open DB
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(filePath, mode, async (error) => {
      if (error) {
        return reject(error);
      }

      try {
        if (wal === true) {
          await runSQL(db, "PRAGMA journal_mode=WAL;");
        }

        resolve(db);
      } catch (error) {
        db.close(() => reject(error));
      }
    });
  });
}

/**
 * Run a SQL command in SQLite
 * @param {sqlite3.Database} db SQLite database instance
 * @param {string} sql SQL command to execute
 * @param {...any} params Parameters for the SQL command
 * @returns {Promise<void>}
 */
export function runSQL(db, sql, ...params) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, (error) => {
      if (error) {
        return reject(error);
      }

      resolve();
    });
  });
}

/**
 * Fetch one row from SQLite database
 * @param {sqlite3.Database} db SQLite database instance
 * @param {string} sql SQL query string
 * @param {...any} params Parameters for the SQL query
 * @returns {Promise<object>} The first row of the query result
 */
export function fetchOne(db, sql, ...params) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (error, row) => {
      if (error) {
        return reject(error);
      }

      resolve(row);
    });
  });
}

/**
 * Fetch all rows from SQLite database
 * @param {sqlite3.Database} db SQLite database instance
 * @param {string} sql SQL query string
 * @param {...any} params Parameters for the SQL query
 * @returns {Promise<Array<object>>} An array of rows
 */
export function fetchAll(db, sql, ...params) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (error, rows) => {
      if (error) {
        return reject(error);
      }

      resolve(rows);
    });
  });
}
