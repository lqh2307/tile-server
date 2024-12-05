"use strict";

import { isFullTransparentPNGImage } from "./image.js";
import { StatusCodes } from "http-status-codes";
import fsPromise from "node:fs/promises";
import protobuf from "protocol-buffers";
import { printLog } from "./logger.js";
import sqlite3 from "sqlite3";
import path from "node:path";
import fs from "node:fs";
import {
  detectFormatAndHeaders,
  getBBoxFromTiles,
  getDataFromURL,
  calculateMD5,
  retry,
  delay,
} from "./utils.js";
import {
  closeSQLite,
  openSQLite,
  fetchAll,
  fetchOne,
  runSQL,
} from "./sqlite.js";

/**
 * Check if a unique index exists on a specified table with given columns
 * @param {sqlite3.Database} mbtilesSource The MBTiles source object
 * @param {string} tableName The name of the table to check
 * @param {Array<string>} columnNames The expected column names in the index
 * @returns {Promise<boolean>} Returns true if the index exists with specified columns, otherwise false
 */
async function isMBTilesExistIndex(mbtilesSource, tableName, columnNames) {
  const indexes = await fetchAll(
    mbtilesSource,
    "PRAGMA index_list (?);",
    tableName
  );

  for (const index of indexes) {
    const columns = await fetchAll(
      mbtilesSource,
      "PRAGMA index_info (?);",
      index.name
    );

    if (
      columns.length === columnNames.length &&
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
async function isMBTilesExistColumns(mbtilesSource, tableName, columnNames) {
  const columns = await fetchAll(
    mbtilesSource,
    "PRAGMA table_info (?);",
    tableName
  );

  const tableColumnNames = columns.map((column) => column.name);

  return columnNames.every((columnName) =>
    tableColumnNames.includes(columnName)
  );
}

/**
 * Create unique index on the metadata table
 * @param {sqlite3.Database} mbtilesSource The MBTiles source object
 * @param {string} indexName The name of the index
 * @param {string} tableName The name of the table to check
 * @param {Array<string>} columnNames The expected column names in the index
 * @returns {Promise<void>}
 */
async function createMBTilesIndex(
  mbtilesSource,
  indexName,
  tableName,
  columnNames
) {
  await runSQL(
    mbtilesSource,
    `CREATE UNIQUE INDEX ? ON ? (${columnNames.join(", ")});`,
    indexName,
    tableName
  );
}

/**
 * Initialize MBTiles database tables
 * @param {sqlite3.Database} mbtilesSource The MBTiles source object
 * @returns {Promise<void>}
 */
async function initializeMBTilesTables(mbtilesSource) {
  await runSQL(
    mbtilesSource,
    `
      CREATE TABLE IF NOT EXISTS
        metadata (
          name TEXT NOT NULL,
          value TEXT NOT NULL,
          PRIMARY KEY (name)
        );
      `
  );

  await runSQL(
    mbtilesSource,
    `
      CREATE TABLE IF NOT EXISTS
        tiles (
          zoom_level INTEGER NOT NULL,
          tile_column INTEGER NOT NULL,
          tile_row INTEGER NOT NULL,
          tile_data BLOB NOT NULL,
          hash TEXT,
          created INTEGER,
          PRIMARY KEY (zoom_level, tile_column, tile_row)
        );
      `
  );
}

/**
 * Get MBTiles layers from tiles
 * @param {sqlite3.Database} mbtilesSource The MBTiles source object
 * @returns {Promise<Array<string>>}
 */
async function getMBTilesLayersFromTiles(mbtilesSource) {
  const layerNames = new Set();
  const batchSize = 200;
  let offset = 0;

  const vectorTileProto = protobuf(
    await fsPromise.readFile("public/protos/vector_tile.proto")
  );

  while (true) {
    const rows = await fetchAll(
      mbtilesSource,
      `SELECT tile_data FROM tiles LIMIT ? OFFSET ?;`,
      batchSize,
      offset
    );

    if (rows.length === 0) {
      break;
    }

    for (const row of rows) {
      vectorTileProto.tile
        .decode(row.tile_data)
        .layers.map((layer) => layer.name)
        .forEach((layer) => layerNames.add(layer));
    }

    offset += batchSize;
  }

  return Array.from(layerNames);
}

/**
 * Get MBTiles bounding box from tiles
 * @param {sqlite3.Database} mbtilesSource The MBTiles source object
 * @returns {Promise<Array<number>>} Bounding box in format [minLon, minLat, maxLon, maxLat]
 */
async function getMBTilesBBoxFromTiles(mbtilesSource) {
  const rows = await fetchAll(
    mbtilesSource,
    `
    SELECT
      zoom_level, MIN(tile_column) AS xMin, MAX(tile_column) AS xMax, MIN(tile_row) AS yMin, MAX(tile_row) AS yMax
    FROM
      tiles
    GROUP BY
      zoom_level;
    `
  );

  if (rows.length > 0) {
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

    return [
      Math.min(...boundsArr.map((bbox) => bbox[0])),
      Math.min(...boundsArr.map((bbox) => bbox[1])),
      Math.max(...boundsArr.map((bbox) => bbox[2])),
      Math.max(...boundsArr.map((bbox) => bbox[3])),
    ];
  }
}

/**
 * Get MBTiles zoom level from tiles
 * @param {sqlite3.Database} mbtilesSource The MBTiles source object
 * @param {"minzoom"|"maxzoom"} zoomType
 * @returns {Promise<number>}
 */
async function getMBTilesZoomLevelFromTiles(
  mbtilesSource,
  zoomType = "maxzoom"
) {
  const data = await fetchOne(
    mbtilesSource,
    zoomType === "minzoom"
      ? "SELECT MIN(zoom_level) AS zoom FROM tiles;"
      : "SELECT MAX(zoom_level) AS zoom FROM tiles;"
  );

  return data?.zoom;
}

/**
 * Get MBTiles tile format from tiles
 * @param {sqlite3.Database} mbtilesSource The MBTiles source object
 * @returns {Promise<string>}
 */
async function getMBTilesFormatFromTiles(mbtilesSource) {
  const data = await fetchOne(mbtilesSource, "SELECT tile_data FROM tiles;");

  if (data !== undefined) {
    return detectFormatAndHeaders(data.tile_data).format;
  }
}

/**
 * Upsert MBTiles metadata table
 * @param {sqlite3.Database} mbtilesSource The MBTiles source object
 * @param {Object<string,string>} metadataAdds Metadata object
 * @returns {Promise<void>}
 */
async function upsertMBTilesMetadata(mbtilesSource, metadataAdds) {
  await Promise.all(
    Object.keys(metadataAdds).map((key) =>
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
        JSON.stringify(metadataAdds[key])
      )
    )
  );
}

/**
 * Upsert MBTiles tile
 * @param {sqlite3.Database} mbtilesSource The MBTiles source object
 * @param {number} z Zoom level
 * @param {number} x X tile index
 * @param {number} y Y tile index
 * @param {string} hash MD5 hash value
 * @param {Buffer} data Tile data buffer
 * @returns {Promise<void>}
 */
async function upsertMBTilesTile(mbtilesSource, z, x, y, hash, data) {
  await runSQL(
    mbtilesSource,
    `
    INSERT INTO
      tiles (zoom_level, tile_column, tile_row, tile_data, hash, created)
    VALUES
      (?, ?, ?, ?, ?, ?)
    ON CONFLICT (zoom_level, tile_column, tile_row)
    DO UPDATE SET tile_data = excluded.tile_data, hash = excluded.hash, created = excluded.created;
    `,
    z,
    x,
    (1 << z) - 1 - y,
    data,
    hash,
    Date.now()
  );
}

/**
 * Create MBTiles tile
 * @param {sqlite3.Database} mbtilesSource The MBTiles source object
 * @param {number} z Zoom level
 * @param {number} x X tile index
 * @param {number} y Y tile index
 * @param {boolean} storeMD5 Is store MD5 hashed?
 * @param {Buffer} data Tile data buffer
 * @param {number} timeout Timeout in milliseconds
 * @returns {Promise<void>}
 */
async function createMBTilesTileWithLock(
  mbtilesSource,
  z,
  x,
  y,
  storeMD5,
  data,
  timeout
) {
  const startTime = Date.now();

  while (Date.now() - startTime <= timeout) {
    try {
      await upsertMBTilesTile(
        mbtilesSource,
        z,
        x,
        y,
        storeMD5 === true ? calculateMD5(data) : undefined,
        data
      );

      return;
    } catch (error) {
      if (error.code === "SQLITE_BUSY") {
        await delay(50);
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
  await runSQL(
    mbtilesSource,
    `
    DELETE FROM
      tiles
    WHERE
      zoom_level = ? AND tile_column = ? AND tile_row = ?;
    `,
    z,
    x,
    (1 << z) - 1 - y
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
async function removeMBTilesTileWithLock(mbtilesSource, z, x, y, timeout) {
  const startTime = Date.now();

  while (Date.now() - startTime <= timeout) {
    try {
      await removeMBTilesTile(mbtilesSource, z, x, y);

      return;
    } catch (error) {
      if (error.code === "SQLITE_BUSY") {
        await delay(50);
      } else {
        throw error;
      }
    }
  }

  throw new Error(`Timeout to access MBTiles DB`);
}

/**
 * Open MBTiles database
 * @param {string} filePath MBTiles file path
 * @param {number} mode SQLite mode (e.g: sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE | sqlite3.OPEN_READONLY)
 * @param {boolean} wal Use WAL
 * @returns {Promise<object>}
 */
export async function openMBTilesDB(
  filePath,
  mode = sqlite3.OPEN_READONLY,
  wal = false
) {
  const mbtilesSource = await openSQLite(filePath, mode, wal);

  if (mode & sqlite3.OPEN_CREATE) {
    await initializeMBTilesTables(mbtilesSource);
  }

  return mbtilesSource;
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
  let data = await fetchOne(
    mbtilesSource,
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
    (1 << z) - 1 - y
  );

  if (!data?.tile_data) {
    throw new Error("Tile does not exist");
  }

  data = Buffer.from(data.tile_data);

  return {
    data: data,
    headers: detectFormatAndHeaders(data).headers,
  };
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
  const rows = await fetchAll(
    mbtilesSource,
    "SELECT name, value FROM metadata;"
  );

  rows.forEach((row) => {
    switch (row.name) {
      case "json":
        Object.assign(metadata, JSON.parse(row.value));

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
export async function closeMBTilesDB(mbtilesSource) {
  await closeSQLite(mbtilesSource);
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

        const response = await getDataFromURL(url, timeout, "stream");

        const tempFilePath = `${filePath}.tmp`;

        const writer = fs.createWriteStream(tempFilePath);

        response.data.pipe(writer);

        return await new Promise((resolve, reject) => {
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
 * Update MBTiles metadata table
 * @param {sqlite3.Database} mbtilesSource The MBTiles source object
 * @param {Object<string,string>} metadataAdds Metadata object
 * @param {number} timeout Timeout in milliseconds
 * @returns {Promise<void>}
 */
export async function updateMBTilesMetadataWithLock(
  mbtilesSource,
  metadataAdds,
  timeout
) {
  const startTime = Date.now();

  while (Date.now() - startTime <= timeout) {
    try {
      await upsertMBTilesMetadata(mbtilesSource, {
        ...metadataAdds,
        scheme: "tms",
      });

      return;
    } catch (error) {
      if (error.code === "SQLITE_BUSY") {
        await delay(50);
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
    const response = await getDataFromURL(url, timeout, "arraybuffer");

    return {
      data: response.data,
      headers: detectFormatAndHeaders(response.data).headers,
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
 * @param {boolean} storeTransparent Is store transparent tile?
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
        const response = await getDataFromURL(url, timeout, "arraybuffer");

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
            storeMD5,
            response.data,
            300000 // 5 mins
          );
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
 * @returns {Promise<void>}
 */
export async function removeMBTilesTileData(
  mbtilesSource,
  z,
  x,
  y,
  maxTry,
  timeout
) {
  const tileName = `${z}/${x}/${y}`;

  printLog("info", `Removing tile data "${tileName}"...`);

  try {
    try {
      await retry(async () => {
        await removeMBTilesTileWithLock(mbtilesSource, z, x, y, timeout);
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
 * @param {boolean} storeMD5 Is store MD5 hashed?
 * @param {boolean} storeTransparent Is store transparent tile?
 * @returns {Promise<void>}
 */
export async function cacheMBtilesTileData(
  mbtilesSource,
  z,
  x,
  y,
  data,
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
        storeMD5,
        data,
        300000 // 5 mins
      );
    }
  } catch (error) {
    printLog("error", `Failed to cache tile data "${tileName}": ${error}`);
  }
}

/**
 * Get MD5 hash of MBTiles tile
 * @param {sqlite3.Database} mbtilesSource The MBTiles source object
 * @param {number} z Zoom level
 * @param {number} x X tile index
 * @param {number} y Y tile index
 * @returns {Promise<string>} Returns the MD5 hash as a string
 */
export async function getMBTilesTileMD5(mbtilesSource, z, x, y) {
  const data = await fetchOne(
    mbtilesSource,
    `
    SELECT
      hash
    FROM
      tiles
    WHERE
      zoom_level = ? AND tile_column = ? AND tile_row = ?;
    `,
    z,
    x,
    (1 << z) - 1 - y
  );

  if (!data?.hash) {
    throw new Error("Tile MD5 does not exist");
  }

  return data.hash;
}

/**
 * Get created of MBTiles tile
 * @param {sqlite3.Database} mbtilesSource The MBTiles source object
 * @param {number} z Zoom level
 * @param {number} x X tile index
 * @param {number} y Y tile index
 * @returns {Promise<number>} Returns the created as a number
 */
export async function getMBTilesTileCreated(mbtilesSource, z, x, y) {
  const data = await fetchOne(
    mbtilesSource,
    `
    SELECT
      created
    FROM
      tiles
    WHERE
      zoom_level = ? AND tile_column = ? AND tile_row = ?;
    `,
    z,
    x,
    (1 << z) - 1 - y
  );

  if (!data?.created) {
    throw new Error("Tile created does not exist");
  }

  return data.created;
}
