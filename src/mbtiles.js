"use strict";

import { detectFormatAndHeaders, createNewTileJSON } from "./utils.js";
import sqlite3 from "sqlite3";

/**
 * Open MBTiles
 * @param {string} filePath
 * @param {"sqlite3.OPEN_READONLY"|"sqlite3.OPEN_READWRITE"} mode
 * @returns {Promise<object>}
 */
export async function openMBTiles(filePath, mode = sqlite3.OPEN_READONLY) {
  return new Promise((resolve, reject) => {
    const mbtilesSource = new sqlite3.Database(filePath, mode, (error) => {
      if (error) {
        return reject(error);
      }

      resolve(mbtilesSource);
    });
  });
}

/**
 * Check if a unique index exists on a specified table with given columns
 * @param {object} mbtilesSource The MBTiles source object
 * @param {string} tableName The name of the table to check
 * @param {Array<string>} columnNames The expected column names in the index
 * @returns {Promise<boolean>} Returns true if the index exists with specified columns, otherwise false
 */
export async function isMBTilesExistIndex(
  mbtilesSource,
  tableName,
  columnNames
) {
  const indexes = await new Promise((resolve, reject) => {
    mbtilesSource.all(`PRAGMA index_list (${tableName})`, (error, indexes) => {
      if (error) {
        return reject(error);
      }

      resolve(indexes);
    });
  });

  if (indexes !== undefined) {
    for (const index of indexes) {
      const columns = await new Promise((resolve, reject) => {
        mbtilesSource.all(
          `PRAGMA index_info (${index.name})`,
          (error, columns) => {
            if (error) {
              return reject(error);
            }

            resolve(columns);
          }
        );
      });

      if (
        columns?.length === columnNames.length &&
        columns.every((col, i) => col.name === columnNames[i])
      ) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Create unique index on the metadata table
 * @param {string} mbtilesFilePath
 * @returns {Promise<void>}
 */
export async function createMBTilesMetadataIndex(mbtilesFilePath) {
  const mbtilesSource = await openMBTiles(
    mbtilesFilePath,
    sqlite3.OPEN_READWRITE
  );

  if (
    (await isMBTilesExistIndex(mbtilesSource, "metadata", ["name"])) === true
  ) {
    return;
  }

  return new Promise((resolve, reject) => {
    mbtilesSource.run(
      "CREATE UNIQUE INDEX metadata_unique_index ON metadata (name)",
      (error) => {
        if (error) {
          return reject(error);
        }

        resolve();
      }
    );
  }).finally(() => {
    mbtilesSource.close();
  });
}

/**
 * Create unique index on the tiles table
 * @param {string} mbtilesFilePath
 * @returns {Promise<void>}
 */
export async function createMBTilesTilesIndex(mbtilesFilePath) {
  const mbtilesSource = await openMBTiles(
    mbtilesFilePath,
    sqlite3.OPEN_READWRITE
  );

  if (
    (await isMBTilesExistIndex(mbtilesSource, "tiles", [
      "zoom_level",
      "tile_column",
      "tile_row",
    ])) === true
  ) {
    return;
  }

  return new Promise((resolve, reject) => {
    mbtilesSource.run(
      "CREATE UNIQUE INDEX tiles_unique_index ON tiles (zoom_level, tile_column, tile_row)",
      (error) => {
        if (error) {
          return reject(error);
        }

        resolve();
      }
    );
  }).finally(() => {
    mbtilesSource.close();
  });
}

/**
 * Get MBTiles tile
 * @param {object} mbtilesSource
 * @param {number} z
 * @param {number} x
 * @param {number} y
 * @returns {Promise<object>}
 */
export async function getMBTilesTile(mbtilesSource, z, x, y) {
  return new Promise((resolve, reject) => {
    mbtilesSource.get(
      `SELECT tile_data FROM tiles WHERE zoom_level = ${z} AND tile_column = ${x} AND tile_row = ${y}`,
      (error, row) => {
        if (error) {
          return reject(error);
        }

        if (!row?.tile_data) {
          return reject(new Error("Tile does not exist"));
        }

        const data = Buffer.from(row.tile_data);

        resolve({
          data: data,
          headers: detectFormatAndHeaders(data).headers,
        });
      }
    );
  });
}

/**
 * Get MBTiles min zoom from tiles
 * @param {object} mbtilesSource
 * @returns {Promise<number>}
 */
export async function getMBTilesMinZoomFromTiles(mbtilesSource) {
  return await new Promise((resolve, reject) => {
    mbtilesSource.get(
      "SELECT MIN(zoom_level) AS minzoom FROM tiles",
      (error, row) => {
        if (error) {
          return reject(error);
        }

        if (row) {
          return resolve(row.minzoom);
        }

        reject(new Error("No tile found"));
      }
    );
  });
}

/**
 * Get MBTiles max zoom from tiles
 * @param {object} mbtilesSource
 * @returns {Promise<number>}
 */
export async function getMBTilesMaxZoomFromTiles(mbtilesSource) {
  return await new Promise((resolve, reject) => {
    mbtilesSource.get(
      "SELECT MAX(zoom_level) AS maxzoom FROM tiles",
      (error, row) => {
        if (error) {
          return reject(error);
        }

        if (row) {
          return resolve(row.maxzoom);
        }

        reject(new Error("No tile found"));
      }
    );
  });
}

/**
 * Get MBTiles tile format from tiles
 * @param {object} mbtilesSource
 * @returns {Promise<number>}
 */
export async function getMBTilesFormatFromTiles(mbtilesSource) {
  return await new Promise((resolve, reject) => {
    mbtilesSource.get("SELECT tile_data FROM tiles LIMIT 1", (error, row) => {
      if (error) {
        return reject(error);
      }

      if (row) {
        return resolve(detectFormatAndHeaders(row.tile_data).format);
      }

      reject(new Error("No tile found"));
    });
  });
}

/**
 * Get MBTiles infos
 * @param {object} mbtilesSource
 * @param {boolean} includeJSON
 * @returns {Promise<object>}
 */
export async function getMBTilesInfos(mbtilesSource, includeJSON = false) {
  const metadata = {};

  /* Get metadatas */
  await new Promise((resolve, reject) => {
    mbtilesSource.all("SELECT name, value FROM metadata", (error, rows) => {
      if (error) {
        return reject(error);
      }

      if (rows) {
        rows.forEach((row) => {
          switch (row.name) {
            case "json":
              if (includeJSON === true) {
                try {
                  Object.assign(metadata, JSON.parse(row.value));
                } catch (error) {
                  return reject(error);
                }
              }

              break;
            case "minzoom":
            case "maxzoom":
              metadata[row.name] = Number(row.value);

              break;
            case "center":
            case "bounds":
              metadata[row.name] = row.value
                .split(",")
                .map((elm) => Number(elm));

              break;
            default:
              metadata[row.name] = row.value;

              break;
          }
        });
      }

      resolve();
    });
  });

  /* Try get min zoom */
  if (metadata.minzoom === undefined) {
    metadata.minzoom = await getMBTilesMinZoomFromTiles(mbtilesSource);
  }

  /* Try get max zoom */
  if (metadata.maxzoom === undefined) {
    metadata.maxzoom = await getMBTilesMaxZoomFromTiles(mbtilesSource);
  }

  /* Try get tile format */
  if (metadata.format === undefined) {
    metadata.format = await getMBTilesFormatFromTiles(mbtilesSource);
  }

  const tileJSON = createNewTileJSON(metadata);

  /* Add vector_layers and tilestats */
  if (includeJSON === true && metadata.format === "pbf") {
    tileJSON.vector_layers = metadata.vector_layers;
    tileJSON.tilestats = metadata.tilestats;
  }

  return tileJSON;
}

/**
 * Close MBTiles
 * @param {object} mbtilesSource
 * @returns {Promise<void>}
 */
export async function closeMBTiles(mbtilesSource) {
  return new Promise((resolve, reject) => {
    mbtilesSource.close((error) => {
      if (error) {
        return reject(error);
      }

      resolve();
    });
  });
}
