"use strict";

import { calculateMD5, delay } from "./utils.js";
import fsPromise from "node:fs/promises";
import sqlite3 from "sqlite3";

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
  try {
    return new Promise((resolve, reject) => {
      mbtilesSource.get(
        `
        SELECT
          hash
        FROM
          md5s
        WHERE
          z = ? AND x = ? AND y = ?;
        `,
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
  } catch (error) {
    return new Promise((resolve, reject) => {
      mbtilesSource.get(
        `
        SELECT
          tile_data
        FROM
          tiles
        WHERE
          zoom_level = ? AND tile_column = ? AND tile_row = ?;
        `,
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

          resolve(calculateMD5(Buffer.from(row.tile_data)));
        }
      );
    });
  }
}

/**
 * Connect to XYZ MD5 SQLite database
 * @param {string} xyzSource
 * @param {number} mode SQLite mode (e.g: sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE | sqlite3.OPEN_READONLY)
 * @returns {Promise<sqlite3.Database>}
 */
async function connectToXYZMD5DB(xyzSource, mode = sqlite3.OPEN_READONLY) {
  // Create folder
  if (mode & sqlite3.OPEN_CREATE) {
    await fsPromise.mkdir(xyzSource, {
      recursive: true,
    });
  }

  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(
      `${xyzSource}/md5.sqlite`,
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

          db.run(
            `
          CREATE TABLE IF NOT EXISTS
            md5s (
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
 * Upsert MD5 hash for a tile
 * @param {sqlite3.Database} db SQLite database instance
 * @param {number} z Zoom level
 * @param {number} x X tile index
 * @param {number} y Y tile index
 * @param {string} hash MD5 hash value
 * @returns {Promise<void>}
 */
async function upsertXYZMD5(db, z, x, y, hash) {
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
 * Get MD5 hash of tile
 * @param {sqlite3.Database} db SQLite database instance
 * @param {number} z Zoom level
 * @param {number} x X tile index
 * @param {number} y Y tile index
 * @returns {Promise<string>} Returns the MD5 hash as a string
 */
async function getXYZMD5(db, z, x, y) {
  return new Promise((resolve, reject) => {
    db.get(
      `
      SELECT
        hash
      FROM
        md5s
      WHERE
        z = ? AND x = ? AND y = ?;
      `,
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
 * Delete MD5 hash of tile
 * @param {sqlite3.Database} db SQLite database instance
 * @param {number} z Zoom level
 * @param {number} x X tile index
 * @param {number} y Y tile index
 * @returns {Promise<void>}
 */
async function deleteXYZMD5(db, z, x, y) {
  return new Promise((resolve, reject) => {
    db.run(
      `
      DELETE FROM
        md5s
      WHERE
        z = ? AND x = ? AND y = ?;
      `,
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
 * Close the XYZ MD5 SQLite database
 * @param {sqlite3.Database} db SQLite database instance
 * @returns {Promise<void>}
 */
async function closeXYZMD5DB(db) {
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
 * @param {string} xyzSource
 * @param {number} z Zoom level
 * @param {number} x X tile index
 * @param {number} y Y tile index
 * @param {Buffer} buffer The data buffer
 * @param {string} hash MD5 hash value
 * @param {number} timeout Timeout in milliseconds
 * @returns {Promise<void>}
 */
export async function updateXYZTileMD5(
  xyzSource,
  z,
  x,
  y,
  buffer,
  hash,
  timeout
) {
  const startTime = Date.now();

  const db = await connectToXYZMD5DB(
    xyzSource,
    sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE
  );

  while (Date.now() - startTime <= timeout) {
    try {
      await upsertXYZMD5(db, z, x, y, hash ?? calculateMD5(buffer));

      await closeXYZMD5DB(db);
    } catch (error) {
      if (error.code === "SQLITE_BUSY") {
        await delay(100);
      } else {
        if (db !== undefined) {
          await closeXYZMD5DB(db);
        }

        throw error;
      }
    }
  }

  throw new Error(`Timeout to access MD5 DB`);
}

/**
 * Delete XYZ tile MD5
 * @param {string} xyzSource
 * @param {number} z Zoom level
 * @param {number} x X tile index
 * @param {number} y Y tile index
 * @param {number} timeout Timeout in milliseconds
 * @returns {Promise<void>}
 */
export async function deleteXYZTileMD5(xyzSource, z, x, y, timeout) {
  const startTime = Date.now();

  const db = await connectToXYZMD5DB(xyzSource, sqlite3.OPEN_READWRITE);

  while (Date.now() - startTime <= timeout) {
    try {
      await deleteXYZMD5(db, z, x, y);

      await closeXYZMD5DB(db);
    } catch (error) {
      if (error.code === "SQLITE_CANTOPEN") {
        return;
      } else if (error.code === "SQLITE_BUSY") {
        await delay(100);
      } else {
        if (db !== undefined) {
          await closeXYZMD5DB(db);
        }

        throw error;
      }
    }
  }

  throw new Error(`Timeout to access MD5 DB`);
}

/**
 * Get XYZ tile MD5
 * @param {string} sourcePath Folder path
 * @param {number} z Zoom level
 * @param {number} x X tile index
 * @param {number} y Y tile index
 * @param {"jpeg"|"jpg"|"pbf"|"png"|"webp"|"gif"} format Tile format
 * @param {number} timeout Timeout in milliseconds
 * @returns {Promise<string>}
 */
export async function getXYZTileMD5(sourcePath, z, x, y, format, timeout) {
  const startTime = Date.now();

  const db = await connectToXYZMD5DB(xyzSource);

  try {
    while (Date.now() - startTime <= timeout) {
      try {
        const md5 = getXYZMD5(db, z, x, y);

        if (db !== undefined) {
          await closeXYZMD5DB(db);
        }

        return md5;
      } catch (error) {
        if (error.code === "SQLITE_CANTOPEN") {
          throw new Error("Tile MD5 does not exist");
        } else if (error.code === "SQLITE_BUSY") {
          await delay(100);
        } else {
          if (db !== undefined) {
            await closeXYZMD5DB(db);
          }

          throw error;
        }
      }
    }

    throw new Error(`Timeout to access MD5 DB`);
  } catch (error) {
    try {
      let data = await fsPromise.readFile(
        `${sourcePath}/${z}/${x}/${y}.${format}`
      );
      if (!data) {
        throw new Error("Tile MD5 does not exist");
      }

      return calculateMD5(Buffer.from(data));
    } catch (error) {
      if (error.code === "ENOENT") {
        throw new Error("Tile MD5 does not exist");
      }

      throw error;
    }
  }
}
