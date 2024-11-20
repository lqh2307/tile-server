"use strict";

import { isMBTilesExistColumns } from "./mbtiles.js";
import fsPromise from "node:fs/promises";
import sqlite3 from "sqlite3";
import { open } from "sqlite";
import path from "node:path";
import crypto from "crypto";

/**
 * Calculate MD5 hash of a buffer
 * @param {Buffer} buffer The buffer data of the file
 * @returns {string} The MD5 hash
 */
export function calculateMD5(buffer) {
  return crypto.createHash("md5").update(buffer).digest("hex");
}

/**
 * Get PMTiles tile MD5
 * @param {object} pmtilesSource
 * @param {number} z Zoom level
 * @param {number} x X tile index
 * @param {number} y Y tile index
 * @returns {Promise<string>}
 */
export async function getPMTilesTileMD5(pmtilesSource, z, x, y) {
  const zxyTile = await pmtilesSource.getZxy(z, x, y);
  if (!zxyTile?.data) {
    throw new Error("Tile MD5 does not exist");
  }

  resolve(calculateMD5(Buffer.from(zxyTile.data)));
}

/**
 * Get MBTiles tile MD5
 * @param {object} mbtilesSource
 * @param {number} z Zoom level
 * @param {number} x X tile index
 * @param {number} y Y tile index
 * @returns {Promise<string>}
 */
export async function getMBTilesTileMD5(mbtilesSource, z, x, y) {
  if (await isMBTilesExistColumns(mbtilesSource, "tiles", ["md5"])) {
    return new Promise((resolve, reject) => {
      mbtilesSource.get(
        `SELECT md5 FROM tiles WHERE zoom_level = ${z} AND tile_column = ${x} AND tile_row = ${y}`,
        (error, row) => {
          if (error) {
            return reject(error);
          }

          if (!row?.md5) {
            return reject(new Error("Tile MD5 does not exist"));
          }

          resolve(row.md5);
        }
      );
    });
  } else {
    return new Promise((resolve, reject) => {
      mbtilesSource.get(
        `SELECT tile_data FROM tiles WHERE zoom_level = ${z} AND tile_column = ${x} AND tile_row = ${y}`,
        (error, row) => {
          if (error) {
            return reject(error);
          }

          if (!row?.tile_data) {
            return reject(new Error("Tile MD5 does not exist"));
          }

          resolve(calculateMD5(Buffer.from(row.tile_data)));
        }
      );
    });
  }
}

/**
 * Connect to XYZ tile MD5 database with WAL mode
 * @param {string} filePath
 * @param {number} timeout Timeout in milliseconds
 * @returns {Promise<sqlite3.Database>}
 */
async function connectToXYZTileMD5DB(filePath, timeout) {
  try {
    const db = await open({
      filename: filePath,
      driver: sqlite3.Database,
    });

    await db.exec("PRAGMA journal_mode=WAL;");
    await db.exec(`PRAGMA busy_timeout=${timeout};`);

    await db.exec(
      `
      CREATE TABLE IF NOT EXISTS md5s (
        z INTEGER NOT NULL,
        x INTEGER NOT NULL,
        y INTEGER NOT NULL,
        hash TEXT NOT NULL,
        PRIMARY KEY (z, x, y)
      );
      `
    );

    return db;
  } catch (error) {
    if (error.code === "ENOENT") {
      await fsPromise.mkdir(path.dirname(filePath), {
        recursive: true,
      });

      return await connectToXYZTileMD5DB(filePath, timeout);
    }

    throw error;
  }
}

/**
 * Update XYZ tile MD5
 * @param {string} filePath
 * @param {number} z Zoom level
 * @param {number} x X tile index
 * @param {number} y Y tile index
 * @param {string} hash
 * @returns {Promise<void>}
 */
export async function updateXYZTileMD5(filePath, z, x, y, hash) {
  let db;

  try {
    db = await connectToXYZTileMD5DB(
      filePath,
      300000 // 5 mins
    );

    await db.run(
      `
      INSERT INTO
        md5s (z, x, y, hash)
      VALUES
        (?, ?, ?, ?)
      ON CONFLICT
        (z, x, y)
      DO
        UPDATE SET hash = excluded.hash;
      `,
      z,
      x,
      y,
      hash
    );
  } catch (error) {
    throw error;
  } finally {
    if (db !== undefined) {
      await db.close();
    }
  }
}

/**
 * Delete XYZ tile MD5
 * @param {string} filePath
 * @param {number} z Zoom level
 * @param {number} x X tile index
 * @param {number} y Y tile index
 * @returns {Promise<void>}
 */
export async function deleteXYZTileMD5(filePath, z, x, y) {
  let db;

  try {
    db = await connectToXYZTileMD5DB(
      filePath,
      300000 // 5 mins
    );

    await db.run(`DELETE FROM md5s WHERE z = ? AND x = ? AND y = ?`, z, x, y);
  } catch (error) {
    throw error;
  } finally {
    if (db !== undefined) {
      await db.close();
    }
  }
}

/**
 * Get XYZ tile MD5
 * @param {string} filePath
 * @param {number} z Zoom level
 * @param {number} x X tile index
 * @param {number} y Y tile index
 * @returns {Promise<string>}
 */
export async function getXYZTileMD5(filePath, z, x, y) {
  let db;

  try {
    db = await connectToXYZTileMD5DB(
      filePath,
      300000 // 5 mins
    );

    const row = await db.get(
      `SELECT hash FROM md5s WHERE z = ? AND x = ? AND y = ?`,
      z,
      x,
      y
    );

    if (!row?.hash) {
      throw new Error("Tile MD5 does not exist");
    }

    return row.hash;
  } catch (error) {
    throw error;
  } finally {
    if (db !== undefined) {
      await db.close();
    }
  }
}
