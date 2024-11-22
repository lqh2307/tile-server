"use strict";

import { calculateMD5, delay, runSQL } from "./utils.js";
import fsPromise from "node:fs/promises";
import sqlite3 from "sqlite3";

/****************************************** MBTiles *********************************************/

/**
 * Get MD5 hash of MBTiles tile
 * @param {sqlite3.Database} mbtilesSource The MBTiles source object
 * @param {number} z Zoom level
 * @param {number} x X tile index
 * @param {number} y Y tile index
 * @returns {Promise<string>} Returns the MD5 hash as a string
 */
export async function getMBTilesMD5(mbtilesSource, z, x, y) {
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

        if (!row?.hash) {
          return reject(new Error("Tile MD5 does not exist"));
        }

        resolve(row.hash);
      }
    );
  });
}

/**
 * Delete MD5 hash of MBTiles tile
 * @param {sqlite3.Database} mbtilesSource The MBTiles source object
 * @param {number} z Zoom level
 * @param {number} x X tile index
 * @param {number} y Y tile index
 * @returns {Promise<void>}
 */
export async function deleteMBTilesMD5(mbtilesSource, z, x, y) {
  return await runSQL(
    mbtilesSource,
    `
    DELETE FROM
      md5s
    WHERE
      z = ? AND x = ? AND y = ?;
    `,
    z,
    x,
    y
  );
}

/**
 * Upsert MD5 hash of MBTiles tile
 * @param {sqlite3.Database} mbtilesSource The MBTiles source object
 * @param {number} z Zoom level
 * @param {number} x X tile index
 * @param {number} y Y tile index
 * @param {string} hash MD5 hash value
 * @returns {Promise<void>}
 */
export async function upsertMBTilesMD5(mbtilesSource, z, x, y, hash) {
  return await runSQL(
    mbtilesSource,
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
}

/**
 * Create MD5 hash of MBTiles tile
 * @param {sqlite3.Database} mbtilesSource The MBTiles source object
 * @param {number} z Zoom level
 * @param {number} x X tile index
 * @param {number} y Y tile index
 * @param {Buffer} buffer The data buffer
 * @param {string} hash MD5 hash value
 * @param {number} timeout Timeout in milliseconds
 * @returns {Promise<void>}
 */
export async function createMBTilesTileMD5WithLock(
  mbtilesSource,
  z,
  x,
  y,
  buffer,
  hash,
  timeout
) {
  const startTime = Date.now();

  while (Date.now() - startTime <= timeout) {
    try {
      await upsertMBTilesMD5(
        mbtilesSource,
        z,
        x,
        y,
        hash ?? calculateMD5(buffer)
      );

      return;
    } catch (error) {
      if (error.code === "SQLITE_BUSY") {
        await delay(100);
      } else {
        throw error;
      }
    }
  }

  throw new Error(`Timeout to access MBTiles DB`);
}

/**
 * Delete MD5 hash of MBTiles tile
 * @param {sqlite3.Database} mbtilesSource The MBTiles source object
 * @param {number} z Zoom level
 * @param {number} x X tile index
 * @param {number} y Y tile index
 * @param {number} timeout Timeout in milliseconds
 * @returns {Promise<void>}
 */
export async function deleteMBTilesTileMD5WithLock(
  mbtilesSource,
  z,
  x,
  y,
  timeout
) {
  const startTime = Date.now();

  while (Date.now() - startTime <= timeout) {
    try {
      await deleteMBTilesMD5(mbtilesSource, z, x, y);

      return;
    } catch (error) {
      if (error.code === "SQLITE_CANTOPEN") {
        return;
      } else if (error.code === "SQLITE_BUSY") {
        await delay(100);
      } else {
        throw error;
      }
    }
  }

  throw new Error(`Timeout to access MBTiles DB`);
}

/**
 * Get MD5 hash of MBTiles tile
 * @param {sqlite3.Database} mbtilesSource The MBTiles source object
 * @param {number} z Zoom level
 * @param {number} x X tile index
 * @param {number} y Y tile index
 * @param {number} timeout Timeout in milliseconds
 * @returns {Promise<string>}
 */
export async function getMBTilesTileMD5WithLock(
  mbtilesSource,
  z,
  x,
  y,
  timeout
) {
  const startTime = Date.now();

  while (Date.now() - startTime <= timeout) {
    try {
      return getMBTilesMD5(mbtilesSource, z, x, y);
    } catch (error) {
      if (error.code === "SQLITE_CANTOPEN") {
        throw new Error("Tile MD5 does not exist");
      } else if (error.code === "SQLITE_BUSY") {
        await delay(100);
      } else {
        throw error;
      }
    }
  }

  throw new Error(`Timeout to access MBTiles DB`);
}

/************************************************************************************************/

/******************************************** XYZ ***********************************************/

/**
 * Open XYZ MD5 SQLite database
 * @param {string} sourcePath
 * @param {number} mode SQLite mode (e.g: sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE | sqlite3.OPEN_READONLY)
 * @param {boolean} wal Use WAL
 * @returns {Promise<sqlite3.Database>}
 */
export async function openXYZMD5DB(
  sourcePath,
  mode = sqlite3.OPEN_READONLY,
  wal = false
) {
  const hasCreateMode = mode & sqlite3.OPEN_CREATE;

  // Create folder
  if (hasCreateMode) {
    await fsPromise.mkdir(sourcePath, {
      recursive: true,
    });
  }

  return new Promise((resolve, reject) => {
    const xyzSource = new sqlite3.Database(
      `${sourcePath}/md5.sqlite`,
      mode,
      (error) => {
        if (error) {
          return reject(error);
        }

        const setupPromises = [];

        if (wal === true) {
          setupPromises.push(runSQL(xyzSource, "PRAGMA journal_mode=WAL;"));
        }

        if (hasCreateMode) {
          setupPromises.push(
            runSQL(
              xyzSource,
              `
              CREATE TABLE IF NOT EXISTS
                md5s (
                  z INTEGER NOT NULL,
                  x INTEGER NOT NULL,
                  y INTEGER NOT NULL,
                  hash TEXT,
                  PRIMARY KEY (z, x, y)
                );
              `
            )
          );
        }

        Promise.all(setupPromises)
          .then(() => resolve(xyzSource))
          .catch((setupError) => {
            if (xyzSource !== undefined) {
              xyzSource.close();
            }

            reject(setupError);
          });
      }
    );
  });
}

/**
 * Upsert MD5 hash of XYZ tile
 * @param {sqlite3.Database} xyzSource SQLite database instance
 * @param {number} z Zoom level
 * @param {number} x X tile index
 * @param {number} y Y tile index
 * @param {string} hash MD5 hash value
 * @returns {Promise<void>}
 */
export async function upsertXYZMD5(xyzSource, z, x, y, hash) {
  return await runSQL(
    xyzSource,
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
}

/**
 * Get MD5 hash of XYZ tile
 * @param {sqlite3.Database} xyzSource SQLite database instance
 * @param {number} z Zoom level
 * @param {number} x X tile index
 * @param {number} y Y tile index
 * @returns {Promise<string>} Returns the MD5 hash as a string
 */
export async function getXYZMD5(xyzSource, z, x, y) {
  return new Promise((resolve, reject) => {
    xyzSource.get(
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
 * Delete MD5 hash of XYZ tile
 * @param {sqlite3.Database} xyzSource SQLite database instance
 * @param {number} z Zoom level
 * @param {number} x X tile index
 * @param {number} y Y tile index
 * @returns {Promise<void>}
 */
export async function deleteXYZMD5(xyzSource, z, x, y) {
  return await runSQL(
    xyzSource,
    `
    DELETE FROM
      md5s
    WHERE
      z = ? AND x = ? AND y = ?;
    `,
    z,
    x,
    y
  );
}

/**
 * Close the XYZ MD5 SQLite database
 * @param {sqlite3.Database} xyzSource SQLite database instance
 * @returns {Promise<void>}
 */
export async function closeXYZMD5DB(xyzSource) {
  return new Promise((resolve, reject) => {
    xyzSource.close((error) => {
      if (error) {
        return reject(error);
      }

      resolve();
    });
  });
}

/**
 * Create MD5 hash of XYZ tile
 * @param {sqlite3.Database} xyzSource SQLite database instance
 * @param {number} z Zoom level
 * @param {number} x X tile index
 * @param {number} y Y tile index
 * @param {Buffer} buffer The data buffer
 * @param {string} hash MD5 hash value
 * @param {number} timeout Timeout in milliseconds
 * @returns {Promise<void>}
 */
export async function createXYZTileMD5WithLock(
  xyzSource,
  z,
  x,
  y,
  buffer,
  hash,
  timeout
) {
  const startTime = Date.now();

  while (Date.now() - startTime <= timeout) {
    try {
      await upsertXYZMD5(xyzSource, z, x, y, hash ?? calculateMD5(buffer));

      return;
    } catch (error) {
      if (error.code === "SQLITE_BUSY") {
        await delay(100);
      } else {
        throw error;
      }
    }
  }

  throw new Error(`Timeout to access MD5 DB`);
}

/**
 * Delete MD5 hash of XYZ tile
 * @param {sqlite3.Database} xyzSource SQLite database instance
 * @param {number} z Zoom level
 * @param {number} x X tile index
 * @param {number} y Y tile index
 * @param {number} timeout Timeout in milliseconds
 * @returns {Promise<void>}
 */
export async function deleteXYZTileMD5WithLock(xyzSource, z, x, y, timeout) {
  const startTime = Date.now();

  while (Date.now() - startTime <= timeout) {
    try {
      await deleteXYZMD5(xyzSource, z, x, y);

      return;
    } catch (error) {
      if (error.code === "SQLITE_CANTOPEN") {
        return;
      } else if (error.code === "SQLITE_BUSY") {
        await delay(100);
      } else {
        throw error;
      }
    }
  }

  throw new Error(`Timeout to access MD5 DB`);
}

/**
 * Get MD5 hash of XYZ tile
 * @param {sqlite3.Database} xyzSource SQLite database instance
 * @param {number} z Zoom level
 * @param {number} x X tile index
 * @param {number} y Y tile index
 * @param {number} timeout Timeout in milliseconds
 * @returns {Promise<string>}
 */
export async function getXYZTileMD5WithLock(xyzSource, z, x, y, timeout) {
  const startTime = Date.now();

  while (Date.now() - startTime <= timeout) {
    try {
      return getXYZMD5(xyzSource, z, x, y);
    } catch (error) {
      if (error.code === "SQLITE_CANTOPEN") {
        throw new Error("Tile MD5 does not exist");
      } else if (error.code === "SQLITE_BUSY") {
        await delay(100);
      } else {
        throw error;
      }
    }
  }

  throw new Error(`Timeout to access MD5 DB`);
}

/************************************************************************************************/
