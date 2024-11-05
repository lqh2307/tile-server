"use strict";

import {
  getLayerNamesFromPBFTileData,
  detectFormatAndHeaders,
  createNewTileJSON,
  downloadFile,
  calculateMD5,
  isExistFile,
  printLog,
  retry,
} from "./utils.js";
import pLimit from "p-limit";
import sqlite3 from "sqlite3";

/**
 * Open MBTiles
 * @param {string} filePath MBTiles file path
 * @param {"sqlite3.OPEN_READONLY"|"sqlite3.OPEN_READWRITE"} mode Open mode
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

  for (const index of indexes || {}) {
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

  return false;
}

/**
 * Check if a columns exists on a specified table
 * @param {object} mbtilesSource The MBTiles source object
 * @param {string} tableName The name of the table to check
 * @param {Array<string>} columnNames The expected column names
 * @returns {Promise<boolean>} Returns true if there columns exist on a specified table, otherwise false
 */
export async function isMBTilesExistColumns(
  mbtilesSource,
  tableName,
  columnNames
) {
  const columns = await new Promise((resolve, reject) => {
    mbtilesSource.all(`PRAGMA table_info (${tableName})`, (error, columns) => {
      if (error) {
        return reject(error);
      }

      resolve(columns);
    });
  });

  const tableColumnNames = (columns || []).map((column) => column.name);

  return columnNames.every((columnName) =>
    tableColumnNames.includes(columnName)
  );
}

/**
 * Get MBTiles layers from tiles
 * @param {object} mbtilesSource The MBTiles source object
 * @returns {Promise<Array<string>>}
 */
export async function getMBTilesLayersFromTiles(mbtilesSource) {
  const limitConcurrencyRead = pLimit(100);
  const layerNames = new Set();

  await new Promise((resolve, reject) => {
    mbtilesSource.all("SELECT tile_data FROM tiles", async (error, rows) => {
      if (error) {
        return reject(error);
      }

      if (rows !== undefined) {
        const promises = rows.map((row) =>
          limitConcurrencyRead(async () => {
            try {
              const layers = await getLayerNamesFromPBFTileData(row.tile_data);

              layers.forEach((layer) => layerNames.add(layer));
            } catch (error) {
              return reject(error);
            }
          })
        );

        await Promise.all(promises);
      }

      resolve();
    });
  });

  return Array.from(layerNames);
}

/**
 * Create unique index on the metadata table
 * @param {string} mbtilesFilePath MBTiles file path
 * @param {string} indexName The name of the index
 * @param {string} tableName The name of the table to check
 * @param {Array<string>} columnNames The expected column names in the index
 * @returns {Promise<void>}
 */
export async function createMBTilesIndex(
  mbtilesFilePath,
  indexName,
  tableName,
  columnNames
) {
  const mbtilesSource = await openMBTiles(
    mbtilesFilePath,
    sqlite3.OPEN_READWRITE
  );

  if (
    (await isMBTilesExistIndex(mbtilesSource, tableName, columnNames)) === true
  ) {
    return;
  }

  return new Promise((resolve, reject) => {
    mbtilesSource.run(
      `CREATE UNIQUE INDEX ${indexName} ON ${tableName} (${columnNames.join(
        ", "
      )})`,
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
 * Get MBTiles tile MD5
 * @param {object} mbtilesSource
 * @param {number} z
 * @param {number} x
 * @param {number} y
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
 * Get MBTiles zoom level from tiles
 * @param {object} mbtilesSource
 * @param {"minzoom"|"maxzoom"} zoomType
 * @returns {Promise<number>}
 */
export async function getMBTilesZoomLevelFromTiles(
  mbtilesSource,
  zoomType = "maxzoom"
) {
  return await new Promise((resolve, reject) => {
    mbtilesSource.get(
      zoomType === "minzoom"
        ? "SELECT MIN(zoom_level) AS zoom FROM tiles"
        : "SELECT MAX(zoom_level) AS zoom FROM tiles",
      (error, row) => {
        if (error) {
          return reject(error);
        }

        if (row !== undefined) {
          return resolve(row.zoom);
        }

        resolve();
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

      if (row !== undefined) {
        return resolve(detectFormatAndHeaders(row.tile_data).format);
      }

      resolve();
    });
  });
}

/**
 * Get MBTiles infos
 * @param {object} mbtilesSource
 * @returns {Promise<object>}
 */
export async function getMBTilesInfos(mbtilesSource) {
  const metadata = {};

  /* Get metadatas */
  await new Promise((resolve, reject) => {
    mbtilesSource.all("SELECT name, value FROM metadata", (error, rows) => {
      if (error) {
        return reject(error);
      }

      if (rows !== undefined) {
        rows.forEach((row) => {
          switch (row.name) {
            case "json":
              try {
                Object.assign(metadata, JSON.parse(row.value));
              } catch (error) {
                return reject(error);
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
    metadata.minzoom = await getMBTilesZoomLevelFromTiles(
      mbtilesSource,
      "minzoom"
    );
  }

  /* Try get max zoom */
  if (metadata.maxzoom === undefined) {
    metadata.maxzoom = await getMBTilesZoomLevelFromTiles(
      mbtilesSource,
      "maxzoom"
    );
  }

  /* Try get tile format */
  if (metadata.format === undefined) {
    metadata.format = await getMBTilesFormatFromTiles(mbtilesSource);
  }

  /* Add vector_layers */
  if (metadata.format === "pbf" && metadata.vector_layers === undefined) {
    const layers = await getMBTilesLayersFromTiles(mbtilesSource);

    metadata.vector_layers = layers.map((layer) => {
      return {
        id: layer,
      };
    });
  }

  return createNewTileJSON(metadata);
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

/**
 * Download MBTiles file
 * @param {string} url The URL to download the file from
 * @param {string} outputPath The path where the file will be saved
 * @param {boolean} overwrite Overwrite exist file
 * @param {number} maxTry Number of retry attempts on failure
 * @param {number} timeout Timeout in milliseconds
 * @returns {Promise<string>} Returns the output path if successful
 */
export async function downloadMBTilesFile(
  url,
  outputPath,
  overwrite = false,
  maxTry = 5,
  timeout = 60000
) {
  try {
    if (overwrite === true || (await isExistFile(outputPath)) === false) {
      printLog(
        "info",
        `Downloading MBTiles file "${outputPath}" from "${url}"...`
      );

      await retry(async () => {
        await downloadFile(url, outputPath, true, timeout);
      }, maxTry);
    }
  } catch (error) {
    throw `Failed to download MBTiles file "${outputPath}" from "${url}": ${error}`;
  }
}
