"use strict";

import { isFullTransparentPNGImage } from "./image.js";
import { StatusCodes } from "http-status-codes";
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
  createMBTilesTileMD5WithLock,
  removeMBTilesTileMD5WithLock,
} from "./md5.js";
import {
  getLayersFromPBFBuffer,
  detectFormatAndHeaders,
  getBBoxFromTiles,
  getDataFromURL,
  retry,
  delay,
  runSQL,
} from "./utils.js";

/**
 * Open MBTiles
 * @param {string} filePath MBTiles file path
 * @param {number} mode SQLite mode (e.g: sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE | sqlite3.OPEN_READONLY)
 * @param {boolean} wal Use WAL
 * @returns {Promise<object>}
 */
export async function openMBTiles(
  filePath,
  mode = sqlite3.OPEN_READONLY,
  wal = false
) {
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

      const setupPromises = [];

      if (wal === true) {
        setupPromises.push(runSQL(mbtilesSource, "PRAGMA journal_mode=WAL;"));
      }

      if (hasCreateMode) {
        setupPromises.push(
          runSQL(
            mbtilesSource,
            `
            CREATE TABLE IF NOT EXISTS
              metadata (
                name TEXT NOT NULL,
                value TEXT NOT NULL,
                PRIMARY KEY (name)
              );
            `
          )
        );

        setupPromises.push(
          runSQL(
            mbtilesSource,
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
            `
          )
        );

        setupPromises.push(
          runSQL(
            mbtilesSource,
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
        .then(() => resolve(mbtilesSource))
        .catch((setupError) => {
          if (mbtilesSource !== undefined) {
            mbtilesSource.close();
          }

          reject(setupError);
        });
    });
  });
}

/**
 * Check if a unique index exists on a specified table with given columns
 * @param {sqlite3.Database} mbtilesSource The MBTiles source object
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
 * @param {sqlite3.Database} mbtilesSource The MBTiles source object
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
 * @param {sqlite3.Database} mbtilesSource The MBTiles source object
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
              const layers = await getLayersFromPBFBuffer(row.tile_data);

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
 * @param {sqlite3.Database} mbtilesSource The MBTiles source object
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
 * @param {sqlite3.Database} mbtilesSource The MBTiles source object
 * @param {string} indexName The name of the index
 * @param {string} tableName The name of the table to check
 * @param {Array<string>} columnNames The expected column names in the index
 * @returns {Promise<void>}
 */
export async function createMBTilesIndex(
  mbtilesSource,
  indexName,
  tableName,
  columnNames
) {
  return await runSQL(
    mbtilesSource,
    `CREATE UNIQUE INDEX ${indexName} ON ${tableName} (${columnNames.join(
      ", "
    )});`
  );
}

/**
 * Get MBTiles tile
 * @param {sqlite3.Database} mbtilesSource The MBTiles source object
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
 * @param {sqlite3.Database} mbtilesSource The MBTiles source object
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
 * @param {sqlite3.Database} mbtilesSource The MBTiles source object
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
 * @param {sqlite3.Database} mbtilesSource The MBTiles source object
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
 * @param {sqlite3.Database} mbtilesSource The MBTiles source object
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

        const tempFilePath = `${filePath}.tmp`;

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

/**
 * Upsert MBTiles metadata table
 * @param {sqlite3.Database} mbtilesSource The MBTiles source object
 * @param {Object<string,string>} metadataAdds Metadata object
 * @returns {Promise<void>}
 */
async function upsertMBTilesMetadata(mbtilesSource, metadataAdds = {}) {
  return new Promise((resolve, reject) =>
    Promise.all(
      Object.entries(metadataAdds).map(([key, value]) =>
        runSQL(
          mbtilesSource,
          `
          INSERT INTO
            metadata (name, value)
          VALUES
            (?, ?)
          ON CONFLICT (name)
          DO UPDATE SET value = excluded.value;
          `,
          key,
          JSON.stringify(value)
        )
      )
    )
      .then(() => resolve())
      .catch((error) => reject(error))
  );
}

/**
 * Update MBTiles metadata table
 * @param {sqlite3.Database} mbtilesSource The MBTiles source object
 * @param {Object<string,string>} metadataAdds Metadata object
 * @param {number} timeout Timeout in milliseconds
 * @returns {Promise<void>}
 */
export async function updateMBTilesMetadataWithLock(
  mbtilesSource,
  metadataAdds = {},
  timeout
) {
  const startTime = Date.now();

  while (Date.now() - startTime <= timeout) {
    try {
      await upsertMBTilesMetadata(mbtilesSource, metadataAdds);

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
 * Upsert MBTiles tile
 * @param {sqlite3.Database} mbtilesSource The MBTiles source object
 * @param {number} z Zoom level
 * @param {number} x X tile index
 * @param {number} y Y tile index
 * @param {Buffer} data Tile data buffer
 * @returns {Promise<void>}
 */
async function upsertMBTilesTile(mbtilesSource, z, x, y, data) {
  return await runSQL(
    mbtilesSource,
    `
    INSERT INTO
      tiles (zoom_level, tile_column, tile_row, tile_data, created)
    VALUES
      (?, ?, ?, ?, ?)
    ON CONFLICT (zoom_level, tile_column, tile_row)
    DO UPDATE SET tile_data = excluded.tile_data, created = excluded.created;
    `,
    z,
    x,
    y,
    data,
    Date.now()
  );
}

/**
 * Create MBTiles tile
 * @param {sqlite3.Database} mbtilesSource The MBTiles source object
 * @param {number} z Zoom level
 * @param {number} x X tile index
 * @param {number} y Y tile index
 * @param {Buffer} data Tile data buffer
 * @param {number} timeout Timeout in milliseconds
 * @returns {Promise<void>}
 */
export async function createMBTilesTileWithLock(
  mbtilesSource,
  z,
  x,
  y,
  data,
  timeout
) {
  const startTime = Date.now();

  while (Date.now() - startTime <= timeout) {
    try {
      await upsertMBTilesTile(mbtilesSource, z, x, y, data);

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
 * Delete a tile from MBTiles tiles table
 * @param {sqlite3.Database} mbtilesSource The MBTiles source object
 * @param {number} z Zoom level
 * @param {number} x X tile index
 * @param {number} y Y tile index
 * @returns {Promise<void>}
 */
async function removeMBTilesTile(mbtilesSource, z, x, y) {
  return await runSQL(
    mbtilesSource,
    `
    DELETE FROM
      tiles
    WHERE
      zoom_level = ? AND tile_column = ? AND tile_row = ?;
    `,
    z,
    x,
    y
  );
}

/**
 * Delete a tile from MBTiles tiles table
 * @param {sqlite3.Database} mbtilesSource The MBTiles source object
 * @param {number} z Zoom level
 * @param {number} x X tile index
 * @param {number} y Y tile index
 * @param {number} timeout Timeout in milliseconds
 * @returns {Promise<void>}
 */
export async function removeMBTilesTileWithLock(
  mbtilesSource,
  z,
  x,
  y,
  timeout
) {
  const startTime = Date.now();

  while (Date.now() - startTime <= timeout) {
    try {
      await removeMBTilesTile(mbtilesSource, z, x, y);

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
 * Get MBTiles tile from a URL
 * @param {string} url The URL to fetch data from
 * @param {number} timeout Timeout in milliseconds
 * @returns {Promise<object>}
 */
export async function getMBTilesTileFromURL(url, timeout) {
  try {
    const response = await getDataFromURL(url, timeout);

    return {
      data: response.data,
      headers: detectFormatAndHeaders(response.data).headers,
      etag: response.headers["Etag"],
    };
  } catch (error) {
    if (error.statusCode !== undefined) {
      if (
        error.statusCode === StatusCodes.NO_CONTENT ||
        error.statusCode === StatusCodes.NOT_FOUND
      ) {
        throw new Error("Tile does not exist");
      } else {
        throw new Error(`Failed to get data tile from "${url}": ${error}`);
      }
    } else {
      throw new Error(`Failed to get data tile from "${url}": ${error}`);
    }
  }
}

/**
 * Download MBTiles tile data
 * @param {string} url The URL to download the file from
 * @param {sqlite3.Database} mbtilesSource The MBTiles source object
 * @param {number} z Zoom level
 * @param {number} x X tile index
 * @param {number} y Y tile index
 * @param {number} maxTry Number of retry attempts on failure
 * @param {number} timeout Timeout in milliseconds
 * @param {boolean} storeMD5 Is store MD5 hashed?
 * @param {boolean} storeTransparent Is store transparent?
 * @returns {Promise<void>}
 */
export async function downloadMBTilesTile(
  url,
  mbtilesSource,
  z,
  x,
  y,
  maxTry,
  timeout,
  storeMD5,
  storeTransparent
) {
  const tileName = `${z}/${x}/${y}`;

  printLog("info", `Downloading tile data "${tileName}" from "${url}"...`);

  try {
    await retry(async () => {
      try {
        // Get data from URL
        const response = await getDataFromURL(url, timeout);

        // Store data
        if (
          storeTransparent === false &&
          (await isFullTransparentPNGImage(response.data)) === true
        ) {
          return;
        } else {
          await createMBTilesTileWithLock(
            mbtilesSource,
            z,
            x,
            y,
            response.data,
            300000 // 5 mins
          );

          // Store data md5 hash
          if (storeMD5 === true) {
            await createMBTilesTileMD5WithLock(
              mbtilesSource,
              z,
              x,
              y,
              response.data,
              response.headers["Etag"],
              180000 // 3 mins
            );
          }
        }
      } catch (error) {
        if (error.statusCode !== undefined) {
          printLog(
            "error",
            `Failed to download tile data "${tileName}" from "${url}": ${error}`
          );

          if (
            error.statusCode === StatusCodes.NO_CONTENT ||
            error.statusCode === StatusCodes.NOT_FOUND
          ) {
            return;
          } else {
            throw new Error(
              `Failed to download tile data "${tileName}" from "${url}": ${error}`
            );
          }
        } else {
          throw new Error(
            `Failed to download tile data "${tileName}" from "${url}": ${error}`
          );
        }
      }
    }, maxTry);
  } catch (error) {
    printLog("error", `${error}`);
  }
}

/**
 * Remove MBTiles tile data
 * @param {sqlite3.Database} mbtilesSource The MBTiles source object
 * @param {number} z Zoom level
 * @param {number} x X tile index
 * @param {number} y Y tile index
 * @param {number} maxTry Number of retry attempts on failure
 * @param {number} timeout Timeout in milliseconds
 * @param {boolean} storeMD5 Is store MD5 hashed?
 * @returns {Promise<void>}
 */
export async function removeMBTilesTileData(
  mbtilesSource,
  z,
  x,
  y,
  maxTry,
  timeout,
  storeMD5
) {
  const tileName = `${z}/${x}/${y}`;

  printLog("info", `Removing tile data "${tileName}"...`);

  try {
    try {
      await retry(async () => {
        await removeMBTilesTileWithLock(mbtilesSource, z, x, y, timeout);

        if (storeMD5 === true) {
          await removeMBTilesTileMD5WithLock(
            sourcePath,
            z,
            x,
            y,
            180000 // 3 mins
          );
        }
      }, maxTry);
    } catch (error) {
      throw new Error(`Failed to remove tile data "${tileName}": ${error}`);
    }
  } catch (error) {
    printLog("error", `${error}`);
  }
}

/**
 * Cache MBTiles tile data
 * @param {sqlite3.Database} mbtilesSource The MBTiles source object
 * @param {number} z Zoom level
 * @param {number} x X tile index
 * @param {number} y Y tile index
 * @param {Buffer} data Tile data buffer
 * @param {string} hash MD5 hash string
 * @param {boolean} storeMD5 Is store MD5 hashed?
 * @param {boolean} storeTransparent Is store transparent?
 * @returns {Promise<void>}
 */
export async function cacheMBtilesTileData(
  mbtilesSource,
  z,
  x,
  y,
  data,
  hash,
  storeMD5,
  storeTransparent
) {
  const tileName = `${z}/${x}/${y}`;

  printLog("info", `Caching tile data "${tileName}"...`);

  try {
    if (
      storeTransparent === false &&
      (await isFullTransparentPNGImage(data)) === true
    ) {
      return;
    } else {
      await createMBTilesTileWithLock(
        mbtilesSource,
        z,
        x,
        y,
        data,
        300000 // 5 mins
      );

      if (storeMD5 === true) {
        await createMBTilesTileMD5WithLock(
          mbtilesSource,
          z,
          x,
          y,
          data,
          hash,
          180000 // 3 mins
        );
      }
    }
  } catch (error) {
    printLog("error", `Failed to cache tile data "${tileName}": ${error}`);
  }
}
