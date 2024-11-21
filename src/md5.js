"use strict";

import fsPromise from "node:fs/promises";
import sqlite3 from "sqlite3";
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
  return new Promise((resolve, reject) => {
    mbtilesSource.get(
      `SELECT hash FROM md5s WHERE z = ? AND x = ? AND y = ?`,
      z,
      x,
      y,
      (error, row) => {
        if (error) {
          return reject(error);
        }

        if (!row?.tile_data) {
          return reject(new Error("Tile MD5 does not exist"));
        }

        resolve();
      }
    );
  });
}

/**
 * Connect to SQLite database
 * @param {string} sourcePath Folder path
 * @param {number} mode SQLite mode (e.g: sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE | sqlite3.OPEN_READONLY)
 * @returns {Promise<sqlite3.Database>}
 */
async function connectToMD5Database(sourcePath, mode = sqlite3.OPEN_READONLY) {
  if (mode & sqlite3.OPEN_CREATE) {
    await fsPromise.mkdir(sourcePath, {
      recursive: true,
    });
  }

  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(
      `${sourcePath}/md5.sqlite`,
      mode,
      (error) => {
        if (error) {
          return reject(error);
        }

        db.serialize(() => {
          db.run("PRAGMA journal_mode=WAL;", (error) => {
            if (error) {
              return reject(error);
            }
          });

          db.run("PRAGMA busy_timeout=300000;", (error) => {
            if (error) {
              return reject(error);
            }
          });

          db.run(
            `
          CREATE TABLE IF NOT EXISTS md5s (
            z INTEGER NOT NULL,
            x INTEGER NOT NULL,
            y INTEGER NOT NULL,
            hash TEXT NOT NULL,
            PRIMARY KEY (z, x, y)
          );
          `,
            (error) => {
              if (error) {
                return reject(error);
              }
            }
          );

          resolve(db);
        });
      }
    );
  });
}

/**
 * Upsert MD5 tile hash for a tile
 * @param {sqlite3.Database} db SQLite database instance
 * @param {number} z Zoom level
 * @param {number} x X tile index
 * @param {number} y Y tile index
 * @param {string} hash MD5 hash value
 * @returns {Promise<void>}
 */
async function upsertMD5Tile(db, z, x, y, hash) {
  return new Promise((resolve, reject) => {
    db.run(
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
      hash,
      (error) => {
        if (error) {
          return reject(error);
        }

        resolve();
      }
    );
  });
}

/**
 * Get XYZ tile MD5
 * @param {sqlite3.Database} db SQLite database instance
 * @param {number} z Zoom level
 * @param {number} x X tile index
 * @param {number} y Y tile index
 * @returns {Promise<string>} Returns the MD5 hash as a string
 */
async function getMD5Tile(db, z, x, y) {
  return new Promise((resolve, reject) => {
    db.get(
      `SELECT hash FROM md5s WHERE z = ? AND x = ? AND y = ?`,
      z,
      x,
      y,
      (error, row) => {
        if (error) {
          return reject(error);
        }

        if (!row?.hash) {
          return reject(new Error("Tile MD5 does not exist"));
        }

        resolve(row.hash);
      }
    );
  });
}

/**
 * Delete MD5 tile hash for a tile
 * @param {sqlite3.Database} db SQLite database instance
 * @param {number} z Zoom level
 * @param {number} x X tile index
 * @param {number} y Y tile index
 * @returns {Promise<void>}
 */
async function deleteMD5Tile(db, z, x, y) {
  return new Promise((resolve, reject) => {
    db.run(
      `DELETE FROM md5s WHERE z = ? AND x = ? AND y = ?`,
      z,
      x,
      y,
      (error) => {
        if (error) {
          return reject(error);
        }

        resolve();
      }
    );
  });
}

/**
 * Close the the MD5 database connection
 * @param {sqlite3.Database} db SQLite database instance
 * @returns {Promise<void>}
 */
async function closeMD5Database(db) {
  return new Promise((resolve, reject) => {
    db.close((error) => {
      if (error) {
        return reject(error);
      }

      resolve();
    });
  });
}

/**
 * Update XYZ tile MD5
 * @param {string} sourcePath Folder path
 * @param {number} z Zoom level
 * @param {number} x X tile index
 * @param {number} y Y tile index
 * @param {string} hash MD5 hash value
 * @returns {Promise<void>}
 */
export async function updateXYZTileMD5(sourcePath, z, x, y, hash) {
  let db;

  try {
    db = await connectToMD5Database(
      sourcePath,
      sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE
    );

    await upsertMD5Tile(db, z, x, y, hash);
  } catch (error) {
    throw error;
  } finally {
    if (db !== undefined) {
      await closeMD5Database(db);
    }
  }
}

/**
 * Delete XYZ tile MD5
 * @param {string} sourcePath Folder path
 * @param {number} z Zoom level
 * @param {number} x X tile index
 * @param {number} y Y tile index
 * @returns {Promise<void>}
 */
export async function deleteXYZTileMD5(sourcePath, z, x, y) {
  let db;

  try {
    db = await connectToMD5Database(sourcePath, sqlite3.OPEN_READWRITE);

    await deleteMD5Tile(db, z, x, y);
  } catch (error) {
    if (error.code === "SQLITE_CANTOPEN") {
      return;
    }

    throw error;
  } finally {
    if (db !== undefined) {
      await closeMD5Database(db);
    }
  }
}

/**
 * Get XYZ tile MD5
 * @param {string} sourcePath Folder path
 * @param {number} z Zoom level
 * @param {number} x X tile index
 * @param {number} y Y tile index
 * @returns {Promise<string>}
 */
export async function getXYZTileMD5(sourcePath, z, x, y) {
  let db;

  try {
    db = await connectToMD5Database(sourcePath);

    return getMD5Tile(db, z, x, y);
  } catch (error) {
    if (error.code === "SQLITE_CANTOPEN") {
      throw new Error("Tile MD5 does not exist");
    }

    throw error;
  } finally {
    if (db !== undefined) {
      await closeMD5Database(db);
    }
  }
}
