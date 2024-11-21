"use strict";

import fsPromise from "node:fs/promises";
import { printLog } from "./logger.js";
import { Mutex } from "async-mutex";
import https from "node:https";
import sqlite3 from "sqlite3";
import http from "node:http";
import path from "node:path";
import axios from "axios";
import fs from "node:fs";
import {
  getLayerNamesFromPBFTileBuffer,
  detectFormatAndHeaders,
  getBBoxFromTiles,
  retry,
  delay,
} from "./utils.js";

/**
 * Open MBTiles
 * @param {string} filePath MBTiles file path
 * @param {number} mode SQLite mode (e.g: sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE | sqlite3.OPEN_READONLY)
 * @returns {Promise<object>}
 */
export async function openMBTiles(filePath, mode = sqlite3.OPEN_READONLY) {
  const hasCreateMode = mode & sqlite3.OPEN_CREATE;

  // Create folder
  if (hasCreateMode) {
    await fsPromise.mkdir(path.dirname(filePath), {
      recursive: true,
    });
  }

  return new Promise((resolve, reject) => {
    const mbtilesSource = new sqlite3.Database(filePath, mode, (error) => {
      if (error) {
        return reject(error);
      }

      if (hasCreateMode) {
        mbtilesSource.serialize(() => {
          mbtilesSource.run(
            `
            CREATE TABLE IF NOT EXISTS
              metadata (
                name TEXT NOT NULL,
                value TEXT NOT NULL,
                PRIMARY KEY (name)
              );
            `,
            (error) => {
              if (error) {
                return reject(error);
              }
            }
          );

          mbtilesSource.run(
            `
            CREATE TABLE IF NOT EXISTS
              tiles (
                zoom_level INTEGER NOT NULL,
                tile_column INTEGER NOT NULL,
                tile_row INTEGER NOT NULL,
                tile_data BLOB NOT NULL,
                created INTEGER,
                PRIMARY KEY (zoom_level, tile_column, tile_row)
              );
            `,
            (error) => {
              if (error) {
                return reject(error);
              }
            }
          );

          mbtilesSource.run(
            `
            CREATE TABLE IF NOT EXISTS
              md5s (
                z INTEGER NOT NULL,
                x INTEGER NOT NULL,
                y INTEGER NOT NULL,
                hash TEXT,
                PRIMARY KEY (z, x, y)
              );
            `,
            (error) => {
              if (error) {
                return reject(error);
              }
            }
          );
        });
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
    mbtilesSource.all(`PRAGMA index_list (${tableName});`, (error, indexes) => {
      if (error) {
        return reject(error);
      }

      resolve(indexes);
    });
  });

  for (const index of indexes || {}) {
    const columns = await new Promise((resolve, reject) => {
      mbtilesSource.all(
        `PRAGMA index_info (${index.name});`,
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
    mbtilesSource.all(`PRAGMA table_info (${tableName});`, (error, columns) => {
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
    mbtilesSource.all("SELECT tile_data FROM tiles;", async (error, rows) => {
      if (error) {
        return reject(error);
      }

      if (rows !== undefined) {
        const layerNames = new Set();
        let totalTasks = rows.length;
        let activeTasks = 0;
        const mutex = new Mutex();

        async function updateActiveTasks(action) {
          return await mutex.runExclusive(async () => {
            return action();
          });
        }

        for (const row of rows) {
          /* Wait slot for a task */
          while (activeTasks >= 200) {
            await delay(50);
          }

          await mutex.runExclusive(() => {
            activeTasks++;

            totalTasks--;
          });

          /* Run a task */
          (async () => {
            try {
              const layers = await getLayerNamesFromPBFTileBuffer(
                row.tile_data
              );

              layers.forEach((layer) => layerNames.add(layer));
            } catch (error) {
              reject(error);
            } finally {
              await updateActiveTasks(() => {
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

      resolve(Array.from(layerNames));
    });
  });
}

/**
 * Get MBTiles bounding box from tiles
 * @param {object} mbtilesSource The MBTiles source object
 * @returns {Promise<Array<number>>} Bounding box in format [minLon, minLat, maxLon, maxLat]
 */
export async function getMBTilesBBoxFromTiles(mbtilesSource) {
  return new Promise((resolve, reject) => {
    mbtilesSource.all(
      `
      SELECT
        zoom_level, MIN(tile_column) AS xMin, MAX(tile_column) AS xMax, MIN(tile_row) AS yMin, MAX(tile_row) AS yMax
      FROM
        tiles
      GROUP BY
        zoom_level;
      `,
      (error, rows) => {
        if (error) {
          return reject(error);
        }

        if (rows !== undefined) {
          const boundsArr = rows.map((row) =>
            getBBoxFromTiles(
              row.xMin,
              row.yMin,
              row.xMax,
              row.yMax,
              row.zoom_level,
              "tms"
            )
          );

          resolve([
            Math.min(...boundsArr.map((bbox) => bbox[0])),
            Math.min(...boundsArr.map((bbox) => bbox[1])),
            Math.max(...boundsArr.map((bbox) => bbox[2])),
            Math.max(...boundsArr.map((bbox) => bbox[3])),
          ]);
        } else {
          resolve();
        }
      }
    );
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

  try {
    if (
      (await isMBTilesExistIndex(mbtilesSource, tableName, columnNames)) ===
      true
    ) {
      return;
    }

    return new Promise((resolve, reject) => {
      mbtilesSource.run(
        `CREATE UNIQUE INDEX ${indexName} ON ${tableName} (${columnNames.join(
          ", "
        )});`,
        (error) => {
          if (error) {
            return reject(error);
          }

          resolve();
        }
      );
    });
  } catch (error) {
    throw error;
  } finally {
    if (mbtilesSource !== undefined) {
      mbtilesSource.close();
    }
  }
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
        ? "SELECT MIN(zoom_level) AS zoom FROM tiles;"
        : "SELECT MAX(zoom_level) AS zoom FROM tiles;",
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
    mbtilesSource.get("SELECT tile_data FROM tiles LIMIT 1;", (error, row) => {
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
  const metadata = {
    name: "Unknown",
    description: "Unknown",
    attribution: "<b>Viettel HighTech</b>",
    version: "1.0.0",
    type: "overlay",
  };

  /* Get metadatas */
  await new Promise((resolve, reject) => {
    mbtilesSource.all("SELECT name, value FROM metadata;", (error, rows) => {
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
              metadata.minzoom = Number(row.value);

              break;
            case "maxzoom":
              metadata.maxzoom = Number(row.value);

              break;
            case "center":
              metadata.center = row.value.split(",").map((elm) => Number(elm));

              break;
            case "format":
              metadata.format = row.value;

              break;
            case "bounds":
              metadata.bounds = row.value.split(",").map((elm) => Number(elm));

              break;
            case "name":
              metadata.name = row.value;

              break;
            case "description":
              metadata.description = row.value;

              break;
            case "attribution":
              metadata.attribution = row.value;

              break;
            case "version":
              metadata.version = row.value;

              break;
            case "type":
              metadata.type = row.value;

              break;
          }
        });
      }

      resolve();
    });
  });

  /* Try get min zoom */
  if (metadata.minzoom === undefined) {
    try {
      metadata.minzoom = await getMBTilesZoomLevelFromTiles(
        mbtilesSource,
        "minzoom"
      );
    } catch (error) {
      metadata.minzoom = 0;
    }
  }

  /* Try get max zoom */
  if (metadata.maxzoom === undefined) {
    try {
      metadata.maxzoom = await getMBTilesZoomLevelFromTiles(
        mbtilesSource,
        "maxzoom"
      );
    } catch (error) {
      metadata.maxzoom = 22;
    }
  }

  /* Try get tile format */
  if (metadata.format === undefined) {
    try {
      metadata.format = await getMBTilesFormatFromTiles(mbtilesSource);
    } catch (error) {
      metadata.format = "png";
    }
  }

  /* Try get bounds */
  if (metadata.bounds === undefined) {
    try {
      metadata.bounds = await getMBTilesBBoxFromTiles(mbtilesSource);
    } catch (error) {
      metadata.bounds = [-180, -85.051129, 180, 85.051129];
    }
  }

  /* Calculate center */
  if (metadata.center === undefined) {
    metadata.center = [
      (metadata.bounds[0] + metadata.bounds[2]) / 2,
      (metadata.bounds[1] + metadata.bounds[3]) / 2,
      Math.floor((metadata.minzoom + metadata.maxzoom) / 2),
    ];
  }

  /* Add vector_layers */
  if (metadata.format === "pbf" && metadata.vector_layers === undefined) {
    try {
      const layers = await getMBTilesLayersFromTiles(mbtilesSource);

      metadata.vector_layers = layers.map((layer) => {
        return {
          id: layer,
        };
      });
    } catch (error) {
      metadata.vector_layers = [];
    }
  }

  return metadata;
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
