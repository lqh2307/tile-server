"use strict";

import { closePostgreSQL, openPostgreSQL } from "./postgresql.js";
import { isFullTransparentPNGImage } from "./image.js";
import { StatusCodes } from "http-status-codes";
import fsPromise from "node:fs/promises";
import protobuf from "protocol-buffers";
import { printLog } from "./logger.js";
import {
  detectFormatAndHeaders,
  getBBoxFromTiles,
  getDataFromURL,
  calculateMD5,
  retry,
} from "./utils.js";

/**
 * Initialize PostgreSQL database tables
 * @param {Client} source PostgreSQL database instance
 * @returns {Promise<void>}
 */
async function initializePostgreSQLTables(source) {
  // Create metadata table
  await source.query(
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
  await source.query(
    `
    CREATE TABLE IF NOT EXISTS
      tiles (
        zoom_level INTEGER NOT NULL,
        tile_column INTEGER NOT NULL,
        tile_row INTEGER NOT NULL,
        tile_data BYTEA NOT NULL,
        hash TEXT,
        created INTEGER,
        PRIMARY KEY (zoom_level, tile_column, tile_row)
      );
    `
  );
}

/**
 * Get PostgreSQL layers from tiles
 * @param {Client} source PostgreSQL database instance
 * @returns {Promise<Array<string>>}
 */
async function getPostgreSQLLayersFromTiles(source) {
  const layerNames = new Set();
  const batchSize = 200;
  let offset = 0;

  const vectorTileProto = protobuf(
    await fsPromise.readFile("public/protos/vector_tile.proto")
  );

  while (true) {
    const rows = await source.query(
      `
      SELECT
        tile_data
      FROM
        tiles
      LIMIT
        $1
      OFFSET
        $2;
      `,
      [batchSize, offset]
    );

    if (rows.rows.length === 0) {
      break;
    }

    for (const row of rows.rows) {
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
 * Get PostgreSQL bounding box from tiles
 * @param {Client} source PostgreSQL database instance
 * @returns {Promise<Array<number>>} Bounding box in format [minLon, minLat, maxLon, maxLat]
 */
async function getPostgreSQLBBoxFromTiles(source) {
  const rows = await source.query(
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

  if (rows.rows.length > 0) {
    const boundsArr = rows.rows.map((row) =>
      getBBoxFromTiles(
        row.xMin,
        row.yMin,
        row.xMax,
        row.yMax,
        row.zoom_level,
        "xyz"
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
 * Get PostgreSQL zoom level from tiles
 * @param {Client} source PostgreSQL database instance
 * @param {"minzoom"|"maxzoom"} zoomType
 * @returns {Promise<number>}
 */
async function getPostgreSQLZoomLevelFromTiles(source, zoomType = "maxzoom") {
  const data = await source.query(
    zoomType === "minzoom"
      ? "SELECT MIN(zoom_level) AS zoom FROM tiles;"
      : "SELECT MAX(zoom_level) AS zoom FROM tiles;"
  );

  if (data.rows.length !== 0) {
    return data.rows[0].zoom;
  }
}

/**
 * Get PostgreSQL tile format from tiles
 * @param {Client} source PostgreSQL database instance
 * @returns {Promise<string>}
 */
async function getPostgreSQLFormatFromTiles(source) {
  const data = await source.query("SELECT tile_data FROM tiles LIMIT 1;");

  if (data.rows.length !== 0) {
    return detectFormatAndHeaders(data.rows[0].tile_data).format;
  }
}

/**
 * Create PostgreSQL tile
 * @param {Client} source PostgreSQL database instance
 * @param {number} z Zoom level
 * @param {number} x X tile index
 * @param {number} y Y tile index
 * @param {boolean} storeMD5 Is store MD5 hashed?
 * @param {Buffer} data Tile data buffer
 * @param {number} timeout Timeout in milliseconds
 * @returns {Promise<void>}
 */
async function createPostgreSQLTileWithLock(
  source,
  z,
  x,
  y,
  storeMD5,
  data,
  timeout
) {
  await source.query({
    text: `
    INSERT INTO
      tiles (zoom_level, tile_column, tile_row, tile_data, hash, created)
    VALUES
      ($1, $2, $3, $4, $5, $6)
    ON CONFLICT (zoom_level, tile_column, tile_row)
    DO UPDATE SET tile_data = excluded.tile_data, hash = excluded.hash, created = excluded.created;
    `,
    values: [
      z,
      x,
      y,
      data,
      storeMD5 === true ? calculateMD5(data) : undefined,
      Date.now(),
    ],
    statement_timeout: timeout,
  });
}

/**
 * Delete a tile from PostgreSQL tiles table
 * @param {Client} source PostgreSQL database instance
 * @param {number} z Zoom level
 * @param {number} x X tile index
 * @param {number} y Y tile index
 * @param {number} timeout Timeout in milliseconds
 * @returns {Promise<void>}
 */
async function removePostgreSQLTileWithLock(source, z, x, y, timeout) {
  await source.query({
    text: `
    DELETE FROM
      tiles
    WHERE
      zoom_level = $1 AND tile_column = $2 AND tile_row = $3;
    `,
    values: [z, x, y],
    statement_timeout: timeout,
  });
}

/**
 * Open PostgreSQL database
 * @param {string} uri Database URI
 * @param {boolean} isCreate Is create database?
 * @returns {Promise<object>}
 */
export async function openPostgreSQLDB(uri, isCreate = false) {
  const source = await openPostgreSQL(uri, isCreate);

  if (isCreate === true) {
    await initializePostgreSQLTables(source);
  }

  return source;
}

/**
 * Get PostgreSQL tile
 * @param {Client} source PostgreSQL database instance
 * @param {number} z Zoom level
 * @param {number} x X tile index
 * @param {number} y Y tile index
 * @returns {Promise<object>}
 */
export async function getPostgreSQLTile(source, z, x, y) {
  let data = await source.query(
    `
    SELECT
      tile_data
    FROM
      tiles
    WHERE
      zoom_level = $1 AND tile_column = $2 AND tile_row = $3;
    `,
    [z, x, y]
  );

  if (data.rows.length === 0) {
    throw new Error("Tile does not exist");
  }

  data = Buffer.from(data.rows[0].tile_data);

  return {
    data: data,
    headers: detectFormatAndHeaders(data).headers,
  };
}

/**
 * Get PostgreSQL infos
 * @param {Client} source PostgreSQL database instance
 * @returns {Promise<object>}
 */
export async function getPostgreSQLInfos(source) {
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
      metadata.minzoom = await getPostgreSQLZoomLevelFromTiles(
        source,
        "minzoom"
      );
    } catch (error) {
      metadata.minzoom = 0;
    }
  }

  /* Try get max zoom */
  if (metadata.maxzoom === undefined) {
    try {
      metadata.maxzoom = await getPostgreSQLZoomLevelFromTiles(
        source,
        "maxzoom"
      );
    } catch (error) {
      metadata.maxzoom = 22;
    }
  }

  /* Try get tile format */
  if (metadata.format === undefined) {
    try {
      metadata.format = await getPostgreSQLFormatFromTiles(source);
    } catch (error) {
      metadata.format = "png";
    }
  }

  /* Try get bounds */
  if (metadata.bounds === undefined) {
    try {
      metadata.bounds = await getPostgreSQLBBoxFromTiles(source);
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
      const layers = await getPostgreSQLLayersFromTiles(source);

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
 * Close PostgreSQL
 * @param {Client} source PostgreSQL database instance
 * @returns {Promise<void>}
 */
export async function closePostgreSQLDB(source) {
  await closePostgreSQL(source);
}

/**
 * Update PostgreSQL metadata table
 * @param {Client} source PostgreSQL database instance
 * @param {Object<string,string>} metadataAdds Metadata object
 * @param {number} timeout Timeout in milliseconds
 * @returns {Promise<void>}
 */
export async function updatePostgreSQLMetadataWithLock(
  source,
  metadataAdds,
  timeout
) {
  await Promise.all(
    Object.entries({
      ...metadataAdds,
      scheme: "xyz",
    }).map(([name, value]) =>
      source.query({
        text: `
        INSERT INTO
          metadata (name, value)
        VALUES
          ($1, $2)
        ON CONFLICT (name)
        DO UPDATE SET value = excluded.value;
        `,
        values: [name, JSON.stringify(value)],
        statement_timeout: timeout,
      })
    )
  );
}

/**
 * Get PostgreSQL tile from a URL
 * @param {string} url The URL to fetch data from
 * @param {number} timeout Timeout in milliseconds
 * @returns {Promise<object>}
 */
export async function getPostgreSQLTileFromURL(url, timeout) {
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
 * Download PostgreSQL tile data
 * @param {string} url The URL to download the file from
 * @param {Client} source PostgreSQL database instance
 * @param {number} z Zoom level
 * @param {number} x X tile index
 * @param {number} y Y tile index
 * @param {number} maxTry Number of retry attempts on failure
 * @param {number} timeout Timeout in milliseconds
 * @param {boolean} storeMD5 Is store MD5 hashed?
 * @param {boolean} storeTransparent Is store transparent tile?
 * @returns {Promise<void>}
 */
export async function downloadPostgreSQLTile(
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
          await createPostgreSQLTileWithLock(
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
 * Remove PostgreSQL tile data
 * @param {Client} source PostgreSQL database instance
 * @param {number} z Zoom level
 * @param {number} x X tile index
 * @param {number} y Y tile index
 * @param {number} maxTry Number of retry attempts on failure
 * @param {number} timeout Timeout in milliseconds
 * @returns {Promise<void>}
 */
export async function removePostgreSQLTileData(
  source,
  z,
  x,
  y,
  maxTry,
  timeout
) {
  const tileName = `${z}/${x}/${y}`;

  printLog("info", `Removing tile data "${tileName}"...`);

  try {
    await retry(async () => {
      await removePostgreSQLTileWithLock(source, z, x, y, timeout);
    }, maxTry);
  } catch (error) {
    printLog("error", `Failed to remove tile data "${tileName}": ${error}`);
  }
}

/**
 * Cache PostgreSQL tile data
 * @param {Client} source PostgreSQL database instance
 * @param {number} z Zoom level
 * @param {number} x X tile index
 * @param {number} y Y tile index
 * @param {Buffer} data Tile data buffer
 * @param {boolean} storeMD5 Is store MD5 hashed?
 * @param {boolean} storeTransparent Is store transparent tile?
 * @returns {Promise<void>}
 */
export async function cachePostgreSQLTileData(
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
      await createPostgreSQLTileWithLock(
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
 * Get MD5 hash of PostgreSQL tile
 * @param {Client} source PostgreSQL database instance
 * @param {number} z Zoom level
 * @param {number} x X tile index
 * @param {number} y Y tile index
 * @returns {Promise<string>} Returns the MD5 hash as a string
 */
export async function getPostgreSQLTileMD5(source, z, x, y) {
  const data = await source.query(
    `
    SELECT
      hash
    FROM
      tiles
    WHERE
      zoom_level = $1 AND tile_column = $2 AND tile_row = $3;
    `,
    [z, x, y]
  );

  if (data.rows.length === 0) {
    throw new Error("Tile MD5 does not exist");
  }

  return data.rows[0].hash;
}

/**
 * Get created of PostgreSQL tile
 * @param {Client} source PostgreSQL database instance
 * @param {number} z Zoom level
 * @param {number} x X tile index
 * @param {number} y Y tile index
 * @returns {Promise<number>} Returns the created as a number
 */
export async function getPostgreSQLTileCreated(source, z, x, y) {
  const data = await source.query(
    `
    SELECT
      created
    FROM
      tiles
    WHERE
      zoom_level = $1 AND tile_column = $2 AND tile_row = $3;
    `,
    [z, x, y]
  );

  if (data.rows.length === 0) {
    throw new Error("Tile created does not exist");
  }

  return data.rows[0].created;
}

/**
 * Get the size of PostgreSQL database
 * @param {Client} source PostgreSQL database instance
 * @param {string} dbName Database name
 * @returns {Promise<number>}
 */
export async function getPostgreSQLSize(source, dbName) {
  const data = await source.query("SELECT pg_database_size($1) AS size;", [
    dbName,
  ]);

  if (data.rows.length !== 0) {
    return data.rows[0].size;
  }
}
