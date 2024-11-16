"use strict";

import fsPromise from "node:fs/promises";
import { printLog } from "./logger.js";
import { Mutex } from "async-mutex";
import {
  getLayerNamesFromPBFTileBuffer,
  detectFormatAndHeaders,
  createNewTileJSON,
  calculateMD5,
  retry,
} from "./utils.js";
import https from "node:https";
import sqlite3 from "sqlite3";
import http from "node:http";
import path from "node:path";
import axios from "axios";
import fs from "node:fs";

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
  return await new Promise((resolve, reject) => {
    mbtilesSource.all("SELECT tile_data FROM tiles", async (error, rows) => {
      if (error) {
        return reject(error);
      }

      if (rows !== undefined) {
        const layerNames = new Set();
        let totalTasks = rows.length;

        if (totalTasks > 0) {
          let activeTasks = 0;
          const mutex = new Mutex();

          for (const row of rows) {
            /* Wait slot for a task */
            while (activeTasks >= concurrency && totalTasks > 0) {
              await delay(50);
            }

            (async () => {
              await mutex.runExclusive(async () => {
                activeTasks++;

                totalTasks--;
              });

              try {
                const layers = await getLayerNamesFromPBFTileBuffer(
                  row.tile_data
                );

                layers.forEach((layer) => layerNames.add(layer));
              } catch (error) {
                reject(error);
              } finally {
                await mutex.runExclusive(() => {
                  activeTasks--;
                });
              }
            })();
          }

          /* Wait all tasks done */
          while (activeTasks > 0) {
            await delay(50);
          }
        }
      }

      resolve(Array.from(layerNames));
    });
  });
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
 * @param {number} z Zoom level
 * @param {number} x X tile index
 * @param {number} y Y tile index
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
 * Download MBTiles file with stream
 * @param {string} url The URL to download the file from
 * @param {string} filePath The path where the file will be saved
 * @param {number} maxTry Number of retry attempts on failure
 * @param {number} timeout Timeout in milliseconds
 * @returns {Promise<void>}
 */
export async function downloadMBTilesFile(url, filePath, maxTry, timeout) {
  printLog("info", `Downloading MBTiles file "${filePath}" from "${url}"...`);

  const tempFilePath = `${filePath}.tmp`;

  try {
    await retry(async () => {
      try {
        await fsPromise.mkdir(path.dirname(filePath), {
          recursive: true,
        });

        const response = await axios({
          url,
          responseType: "stream",
          method: "GET",
          timeout: timeout,
          headers: {
            "User-Agent": "Tile Server",
          },
          validateStatus: (status) => {
            return status === StatusCodes.OK;
          },
          httpAgent: new http.Agent({
            keepAlive: false,
          }),
          httpsAgent: new https.Agent({
            keepAlive: false,
          }),
        });

        const writer = fs.createWriteStream(tempFilePath);

        response.data.pipe(writer);

        return new Promise((resolve, reject) => {
          writer
            .on("finish", async () => {
              await fsPromise.rename(tempFilePath, filePath);

              resolve();
            })
            .on("error", async (error) => {
              await fsPromise.rm(tempFilePath, {
                force: true,
              });

              reject(error);
            });
        });
      } catch (error) {
        if (error.response) {
          if (
            response.status === StatusCodes.NO_CONTENT ||
            response.status === StatusCodes.NOT_FOUND
          ) {
            printLog(
              "error",
              `Failed to download MBTiles file "${filePath}" from "${url}": Status code: ${response.status} - ${response.statusText}`
            );

            return;
          } else {
            throw new Error(
              `Failed to download MBTiles file "${filePath}" from "${url}": Status code: ${error.response.status} - ${error.response.statusText}`
            );
          }
        }

        throw new Error(
          `Failed to download MBTiles file "${filePath}" from "${url}": ${error}`
        );
      }
    }, maxTry);
  } catch (error) {
    throw error;
  }
}
