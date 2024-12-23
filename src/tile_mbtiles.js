"use strict";

import { isFullTransparentPNGImage } from "./image.js";
import { OPEN_CREATE, OPEN_READONLY } from "sqlite3";
import { StatusCodes } from "http-status-codes";
import fsPromise from "node:fs/promises";
import protobuf from "protocol-buffers";
import { printLog } from "./logger.js";
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
 * Initialize MBTiles database tables
 * @param {Database} source SQLite database instance
 * @returns {Promise<void>}
 */
async function initializeMBTilesTables(source) {
  // Create metadata table
  await runSQL(
    source,
    `
    CREATE TABLE IF NOT EXISTS
      metadata (
        name TEXT NOT NULL,
        value TEXT NOT NULL,
        PRIMARY KEY (name)
      );
    `
  );

  // Create tiles table
  await runSQL(
    source,
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
 * @param {Database} source SQLite database instance
 * @returns {Promise<Array<string>>}
 */
async function getMBTilesLayersFromTiles(source) {
  const layerNames = new Set();
  const batchSize = 200;
  let offset = 0;

  const vectorTileProto = protobuf(
    await fsPromise.readFile("public/protos/vector_tile.proto")
  );

  while (true) {
    const rows = await fetchAll(
      source,
      `
      SELECT
        tile_data
      FROM
        tiles
      LIMIT
        ?
      OFFSET
        ?;
      `,
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
 * @param {Database} source SQLite database instance
 * @returns {Promise<Array<number>>} Bounding box in format [minLon, minLat, maxLon, maxLat]
 */
async function getMBTilesBBoxFromTiles(source) {
  const rows = await fetchAll(
    source,
    `
    SELECT
      zoom_level,
      MIN(tile_column) AS xMin,
      MAX(tile_column) AS xMax,
      MIN(tile_row) AS yMin,
      MAX(tile_row) AS yMax
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
 * @param {Database} source SQLite database instance
 * @param {"minzoom"|"maxzoom"} zoomType
 * @returns {Promise<number>}
 */
async function getMBTilesZoomLevelFromTiles(source, zoomType = "maxzoom") {
  const data = await fetchOne(
    source,
    zoomType === "minzoom"
      ? "SELECT MIN(zoom_level) AS zoom FROM tiles;"
      : "SELECT MAX(zoom_level) AS zoom FROM tiles;"
  );

  return data?.zoom;
}

/**
 * Get MBTiles tile format from tiles
 * @param {Database} source SQLite database instance
 * @returns {Promise<string>}
 */
async function getMBTilesFormatFromTiles(source) {
  const data = await fetchOne(source, "SELECT tile_data FROM tiles LIMIT 1;");

  if (data !== undefined) {
    return detectFormatAndHeaders(data.tile_data).format;
  }
}

/**
 * Create MBTiles tile
 * @param {Database} source SQLite database instance
 * @param {number} z Zoom level
 * @param {number} x X tile index
 * @param {number} y Y tile index
 * @param {boolean} storeMD5 Is store MD5 hashed?
 * @param {Buffer} data Tile data buffer
 * @param {number} timeout Timeout in milliseconds
 * @returns {Promise<void>}
 */
async function createMBTilesTileWithLock(
  source,
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
      await runSQL(
        source,
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
        storeMD5 === true ? calculateMD5(data) : undefined,
        Date.now()
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
 * @param {Database} source SQLite database instance
 * @param {number} z Zoom level
 * @param {number} x X tile index
 * @param {number} y Y tile index
 * @param {number} timeout Timeout in milliseconds
 * @returns {Promise<void>}
 */
async function removeMBTilesTileWithLock(source, z, x, y, timeout) {
  const startTime = Date.now();

  while (Date.now() - startTime <= timeout) {
    try {
      await runSQL(
        source,
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
 * @param {string} filePath MBTiles filepath
 * @param {number} mode SQLite mode (e.g: OPEN_READWRITE | OPEN_CREATE | OPEN_READONLY)
 * @param {boolean} wal Use WAL
 * @returns {Promise<object>}
 */
export async function openMBTilesDB(
  filePath,
  mode = OPEN_READONLY,
  wal = false
) {
  const source = await openSQLite(filePath, mode, wal);

  if (mode & OPEN_CREATE) {
    await initializeMBTilesTables(source);
  }

  return source;
}

/**
 * Get MBTiles tile
 * @param {Database} source SQLite database instance
 * @param {number} z Zoom level
 * @param {number} x X tile index
 * @param {number} y Y tile index
 * @returns {Promise<object>}
 */
export async function getMBTilesTile(source, z, x, y) {
  let data = await fetchOne(
    source,
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
 * @param {Database} source SQLite database instance
 * @returns {Promise<object>}
 */
export async function getMBTilesInfos(source) {
  const metadata = {
    name: "Unknown",
    description: "Unknown",
    attribution: "<b>Viettel HighTech</b>",
    version: "1.0.0",
    type: "overlay",
  };

  /* Get metadatas */
  const rows = await fetchAll(source, "SELECT name, value FROM metadata;");

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
      metadata.minzoom = await getMBTilesZoomLevelFromTiles(source, "minzoom");
    } catch (error) {
      metadata.minzoom = 0;
    }
  }

  /* Try get max zoom */
  if (metadata.maxzoom === undefined) {
    try {
      metadata.maxzoom = await getMBTilesZoomLevelFromTiles(source, "maxzoom");
    } catch (error) {
      metadata.maxzoom = 22;
    }
  }

  /* Try get tile format */
  if (metadata.format === undefined) {
    try {
      metadata.format = await getMBTilesFormatFromTiles(source);
    } catch (error) {
      metadata.format = "png";
    }
  }

  /* Try get bounds */
  if (metadata.bounds === undefined) {
    try {
      metadata.bounds = await getMBTilesBBoxFromTiles(source);
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
      const layers = await getMBTilesLayersFromTiles(source);

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
 * @param {Database} source SQLite database instance
 * @returns {Promise<void>}
 */
export async function closeMBTilesDB(source) {
  await closeSQLite(source);
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
 * @param {Database} source SQLite database instance
 * @param {Object<string,string>} metadataAdds Metadata object
 * @param {number} timeout Timeout in milliseconds
 * @returns {Promise<void>}
 */
export async function updateMBTilesMetadataWithLock(
  source,
  metadataAdds,
  timeout
) {
  const startTime = Date.now();

  while (Date.now() - startTime <= timeout) {
    try {
      await Promise.all(
        Object.entries({
          ...metadataAdds,
          scheme: "tms",
        }).map(([name, value]) =>
          runSQL(
            source,
            `
            INSERT INTO
              metadata (name, value)
            VALUES
              (?, ?)
            ON CONFLICT (name)
            DO UPDATE SET value = excluded.value;
            `,
            name,
            JSON.stringify(value)
          )
        )
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
 * @param {Database} source SQLite database instance
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
  source,
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
            source,
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
 * @param {Database} source SQLite database instance
 * @param {number} z Zoom level
 * @param {number} x X tile index
 * @param {number} y Y tile index
 * @param {number} maxTry Number of retry attempts on failure
 * @param {number} timeout Timeout in milliseconds
 * @returns {Promise<void>}
 */
export async function removeMBTilesTileData(source, z, x, y, maxTry, timeout) {
  const tileName = `${z}/${x}/${y}`;

  printLog("info", `Removing tile data "${tileName}"...`);

  try {
    await retry(async () => {
      await removeMBTilesTileWithLock(source, z, x, y, timeout);
    }, maxTry);
  } catch (error) {
    printLog("error", `Failed to remove tile data "${tileName}": ${error}`);
  }
}

/**
 * Cache MBTiles tile data
 * @param {Database} source SQLite database instance
 * @param {number} z Zoom level
 * @param {number} x X tile index
 * @param {number} y Y tile index
 * @param {Buffer} data Tile data buffer
 * @param {boolean} storeMD5 Is store MD5 hashed?
 * @param {boolean} storeTransparent Is store transparent tile?
 * @returns {Promise<void>}
 */
export async function cacheMBtilesTileData(
  source,
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
        source,
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
 * @param {Database} source SQLite database instance
 * @param {number} z Zoom level
 * @param {number} x X tile index
 * @param {number} y Y tile index
 * @returns {Promise<string>} Returns the MD5 hash as a string
 */
export async function getMBTilesTileMD5(source, z, x, y) {
  const data = await fetchOne(
    source,
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
 * @param {Database} source SQLite database instance
 * @param {number} z Zoom level
 * @param {number} x X tile index
 * @param {number} y Y tile index
 * @returns {Promise<number>} Returns the created as a number
 */
export async function getMBTilesTileCreated(source, z, x, y) {
  const data = await fetchOne(
    source,
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
