"use strict";

import { closeSQLite, fetchOne, openSQLite, runSQL } from "./sqlite.js";
import { isFullTransparentPNGImage } from "./image.js";
import { StatusCodes } from "http-status-codes";
import fsPromise from "node:fs/promises";
import protobuf from "protocol-buffers";
import { printLog } from "./logger.js";
import { Mutex } from "async-mutex";
import sqlite3 from "sqlite3";
import path from "node:path";
import {
  detectFormatAndHeaders,
  getBBoxFromTiles,
  getDataFromURL,
  calculateMD5,
  findFolders,
  findFiles,
  delay,
  retry,
} from "./utils.js";

/**
 * Get XYZ layers from tiles
 * @param {string} sourcePath XYZ folder path
 * @returns {Promise<Array<string>>}
 */
async function getXYZLayersFromTiles(sourcePath) {
  const mutex = new Mutex();

  async function updateActiveTasks(action) {
    return await mutex.runExclusive(async () => {
      return action();
    });
  }

  const pbfFilePaths = await findFiles(sourcePath, /^\d+\.pbf$/, true);
  let totalTasks = pbfFilePaths.length;
  const layerNames = new Set();
  let activeTasks = 0;

  const vectorTileProto = protobuf(
    await fsPromise.readFile("public/protos/vector_tile.proto")
  );

  for (const pbfFilePath of pbfFilePaths) {
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
        vectorTileProto.tile
          .decode(await fsPromise.readFile(`${sourcePath}/${pbfFilePath}`))
          .layers.map((layer) => layer.name)
          .forEach((layer) => layerNames.add(layer));
      } catch (error) {
        throw error;
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

  return Array.from(layerNames);
}

/**
 * Get XYZ tile format from tiles
 * @param {string} sourcePath XYZ folder path
 * @returns {Promise<string>}
 */
async function getXYZFormatFromTiles(sourcePath) {
  const zFolders = await findFolders(sourcePath, /^\d+$/, false);

  for (const zFolder of zFolders) {
    const xFolders = await findFolders(
      `${sourcePath}/${zFolder}`,
      /^\d+$/,
      false
    );

    for (const xFolder of xFolders) {
      const yFiles = await findFiles(
        `${sourcePath}/${zFolder}/${xFolder}`,
        /^\d+\.(gif|png|jpg|jpeg|webp|pbf)$/,
        false
      );

      if (yFiles.length > 0) {
        return yFiles[0].split(".")[1];
      }
    }
  }
}

/**
 * Get XYZ bounding box from tiles
 * @param {string} sourcePath XYZ folder path
 * @returns {Promise<Array<number>>} Bounding box in format [minLon, minLat, maxLon, maxLat]
 */
async function getXYZBBoxFromTiles(sourcePath) {
  const zFolders = await findFolders(sourcePath, /^\d+$/, false);
  const boundsArr = [];

  for (const zFolder of zFolders) {
    const xFolders = await findFolders(
      `${sourcePath}/${zFolder}`,
      /^\d+$/,
      false
    );

    if (xFolders.length > 0) {
      const xMin = Math.min(...xFolders.map((folder) => Number(folder)));
      const xMax = Math.max(...xFolders.map((folder) => Number(folder)));

      for (const xFolder of xFolders) {
        let yFiles = await findFiles(
          `${sourcePath}/${zFolder}/${xFolder}`,
          /^\d+\.(gif|png|jpg|jpeg|webp|pbf)$/,
          false
        );

        if (yFiles.length > 0) {
          yFiles = yFiles.map((yFile) => yFile.split(".")[0]);

          const yMin = Math.min(...yFiles.map((file) => Number(file)));
          const yMax = Math.max(...yFiles.map((file) => Number(file)));

          boundsArr.push(
            getBBoxFromTiles(xMin, yMin, xMax, yMax, zFolder, "xyz")
          );
        }
      }
    }
  }

  if (boundsArr.length > 0) {
    return [
      Math.min(...boundsArr.map((bbox) => bbox[0])),
      Math.min(...boundsArr.map((bbox) => bbox[1])),
      Math.max(...boundsArr.map((bbox) => bbox[2])),
      Math.max(...boundsArr.map((bbox) => bbox[3])),
    ];
  }
}

/**
 * Get XYZ zoom level from tiles
 * @param {string} sourcePath XYZ folder path
 * @param {"minzoom"|"maxzoom"} zoomType
 * @returns {Promise<number>}
 */
async function getXYZZoomLevelFromTiles(sourcePath, zoomType = "maxzoom") {
  const folders = await findFolders(sourcePath, /^\d+$/, false);

  return zoomType === "minzoom"
    ? Math.min(...folders.map((folder) => Number(folder)))
    : Math.max(...folders.map((folder) => Number(folder)));
}

/**
 * Update XYZ metadata.json file
 * @param {string} filePath File path to store metadata.json file
 * @param {Object<string,string>} metadataAdds Metadata object
 * @returns {Promise<void>}
 */
async function updateXYZMetadataFile(filePath, metadataAdds) {
  const tempFilePath = `${filePath}.tmp`;

  try {
    const data = await fsPromise.readFile(filePath, "utf8");

    const metadatas = JSON.parse(data);

    await fsPromise.writeFile(
      tempFilePath,
      JSON.stringify(
        {
          ...metadatas,
          ...metadataAdds,
        },
        null,
        2
      ),
      "utf8"
    );

    await fsPromise.rename(tempFilePath, filePath);
  } catch (error) {
    if (error.code === "ENOENT") {
      await fsPromise.mkdir(path.dirname(filePath), {
        recursive: true,
      });

      await fsPromise.writeFile(
        filePath,
        JSON.stringify(metadataAdds, null, 2),
        "utf8"
      );
    } else {
      await fsPromise.rm(tempFilePath, {
        force: true,
      });

      throw error;
    }
  }
}

/**
 * Create XYZ tile data file
 * @param {string} filePath File path to store tile data file
 * @param {Buffer} data Tile data buffer
 * @returns {Promise<void>}
 */
async function createXYZTileDataFile(filePath, data) {
  const tempFilePath = `${filePath}.tmp`;

  try {
    await fsPromise.mkdir(path.dirname(filePath), {
      recursive: true,
    });

    await fsPromise.writeFile(tempFilePath, data);

    await fsPromise.rename(tempFilePath, filePath);
  } catch (error) {
    await fsPromise.rm(tempFilePath, {
      force: true,
    });

    throw error;
  }
}

/**
 * Create XYZ tile data file with lock
 * @param {string} filePath File path to store tile data file
 * @param {Buffer} data Tile data buffer
 * @param {number} timeout Timeout in milliseconds
 * @returns {Promise<void>}
 */
async function createXYZTileDataFileWithLock(filePath, data, timeout) {
  const startTime = Date.now();

  const lockFilePath = `${filePath}.lock`;
  let lockFileHandle;

  while (Date.now() - startTime <= timeout) {
    try {
      lockFileHandle = await fsPromise.open(lockFilePath, "wx");

      await createXYZTileDataFile(filePath, data);

      await lockFileHandle.close();

      await fsPromise.rm(lockFilePath, {
        force: true,
      });

      return;
    } catch (error) {
      if (error.code === "ENOENT") {
        await fsPromise.mkdir(path.dirname(filePath), {
          recursive: true,
        });

        continue;
      } else if (error.code === "EEXIST") {
        await delay(50);
      } else {
        if (lockFileHandle !== undefined) {
          await lockFileHandle.close();

          await fsPromise.rm(lockFilePath, {
            force: true,
          });
        }

        throw error;
      }
    }
  }

  throw new Error(`Timeout to access lock file`);
}

/**
 * Remove XYZ tile data file with lock
 * @param {string} filePath File path to remove tile data file
 * @param {number} timeout Timeout in milliseconds
 * @returns {Promise<void>}
 */
async function removeXYZTileDataFileWithLock(filePath, timeout) {
  const startTime = Date.now();

  const lockFilePath = `${filePath}.lock`;
  let lockFileHandle;

  while (Date.now() - startTime <= timeout) {
    try {
      lockFileHandle = await fsPromise.open(lockFilePath, "wx");

      await fsPromise.rm(filePath, {
        force: true,
      });

      await lockFileHandle.close();

      await fsPromise.rm(lockFilePath, {
        force: true,
      });

      return;
    } catch (error) {
      if (error.code === "ENOENT") {
        return;
      } else if (error.code === "EEXIST") {
        await delay(50);
      } else {
        if (lockFileHandle !== undefined) {
          await lockFileHandle.close();

          await fsPromise.rm(lockFilePath, {
            force: true,
          });
        }

        throw error;
      }
    }
  }

  throw new Error(`Timeout to access lock file`);
}

/**
 * Initialize XYZ MD5 database tables
 * @param {sqlite3.Database} xyzSource SQLite database instance
 * @returns {Promise<void>}
 */
async function initializeXYZMD5Tables(xyzSource) {
  return await runSQL(
    xyzSource,
    `
    CREATE TABLE IF NOT EXISTS
      md5s (
        zoom_level INTEGER NOT NULL,
        tile_column INTEGER NOT NULL,
        tile_row INTEGER NOT NULL,
        hash TEXT,
        PRIMARY KEY (zoom_level, tile_column, tile_row)
      );
    `
  );
}

/**
 * Remove MD5 hash of XYZ tile
 * @param {sqlite3.Database} xyzSource SQLite database instance
 * @param {number} z Zoom level
 * @param {number} x X tile index
 * @param {number} y Y tile index
 * @returns {Promise<void>}
 */
async function removeXYZTileMD5(xyzSource, z, x, y) {
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
 * Upsert MD5 hash of XYZ tile
 * @param {sqlite3.Database} xyzSource SQLite database instance
 * @param {number} z Zoom level
 * @param {number} x X tile index
 * @param {number} y Y tile index
 * @param {string} hash MD5 hash value
 * @returns {Promise<void>}
 */
async function upsertXYZTileMD5(xyzSource, z, x, y, hash) {
  return await runSQL(
    xyzSource,
    `
    INSERT INTO
      md5s (zoom_level, tile_column, tile_row, hash)
    VALUES
      (?, ?, ?, ?)
    ON CONFLICT
      (zoom_level, tile_column, tile_row)
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
async function createXYZTileMD5WithLock(
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
      await upsertXYZTileMD5(xyzSource, z, x, y, hash ?? calculateMD5(buffer));

      return;
    } catch (error) {
      if (error.code === "SQLITE_BUSY") {
        await delay(50);
      } else {
        throw error;
      }
    }
  }

  throw new Error(`Timeout to access XYZ MD5 DB`);
}

/**
 * Remove MD5 hash of XYZ tile
 * @param {sqlite3.Database} xyzSource SQLite database instance
 * @param {number} z Zoom level
 * @param {number} x X tile index
 * @param {number} y Y tile index
 * @param {number} timeout Timeout in milliseconds
 * @returns {Promise<void>}
 */
async function removeXYZTileMD5WithLock(xyzSource, z, x, y, timeout) {
  const startTime = Date.now();

  while (Date.now() - startTime <= timeout) {
    try {
      await removeXYZTileMD5(xyzSource, z, x, y);

      return;
    } catch (error) {
      if (error.code === "SQLITE_CANTOPEN") {
        return;
      } else if (error.code === "SQLITE_BUSY") {
        await delay(50);
      } else {
        throw error;
      }
    }
  }

  throw new Error(`Timeout to access XYZ MD5 DB`);
}

/**
 * Get XYZ tile
 * @param {string} sourcePath XYZ folder path
 * @param {number} z Zoom level
 * @param {number} x X tile index
 * @param {number} y Y tile index
 * @param {"jpeg"|"jpg"|"pbf"|"png"|"webp"|"gif"} format Tile format
 * @returns {Promise<object>}
 */
export async function getXYZTile(sourcePath, z, x, y, format) {
  try {
    let data = await fsPromise.readFile(
      `${sourcePath}/${z}/${x}/${y}.${format}`
    );
    if (!data) {
      throw new Error("Tile does not exist");
    }

    data = Buffer.from(data);

    return {
      data: data,
      headers: detectFormatAndHeaders(data).headers,
    };
  } catch (error) {
    if (error.code === "ENOENT") {
      throw new Error("Tile does not exist");
    } else {
      throw error;
    }
  }
}

/**
 * Get XYZ tile from a URL
 * @param {string} url The URL to fetch data from
 * @param {number} timeout Timeout in milliseconds
 * @returns {Promise<object>}
 */
export async function getXYZTileFromURL(url, timeout) {
  try {
    const response = await getDataFromURL(url, timeout, "arraybuffer");

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
 * Get XYZ infos
 * @param {string} sourcePath XYZ folder path
 * @returns {Promise<object>}
 */
export async function getXYZInfos(sourcePath) {
  const metadata = {
    name: "Unknown",
    description: "Unknown",
    attribution: "<b>Viettel HighTech</b>",
    version: "1.0.0",
    type: "overlay",
  };

  /* Get metadatas */
  try {
    const data = await fsPromise.readFile(
      `${sourcePath}/metadata.json`,
      "utf8"
    );

    Object.assign(metadata, JSON.parse(data));
  } catch (error) {}

  /* Try get min zoom */
  if (metadata.minzoom === undefined) {
    try {
      metadata.minzoom = await getXYZZoomLevelFromTiles(sourcePath, "minzoom");
    } catch (error) {
      metadata.minzoom = 0;
    }
  }

  /* Try get max zoom */
  if (metadata.maxzoom === undefined) {
    try {
      metadata.maxzoom = await getXYZZoomLevelFromTiles(sourcePath, "maxzoom");
    } catch (error) {
      metadata.maxzoom = 22;
    }
  }

  /* Try get tile format */
  if (metadata.format === undefined) {
    try {
      metadata.format = await getXYZFormatFromTiles(sourcePath);
    } catch (error) {
      metadata.format = "png";
    }
  }

  /* Try get bounds */
  if (metadata.bounds === undefined) {
    try {
      metadata.bounds = await getXYZBBoxFromTiles(sourcePath);
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
      const layers = await getXYZLayersFromTiles(sourcePath);

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
 * Update XYZ metadata.json file with lock
 * @param {string} filePath File path to store metadata.json file
 * @param {Object<string,string>} metadataAdds Metadata object
 * @param {number} timeout Timeout in milliseconds
 * @returns {Promise<void>}
 */
export async function updateXYZMetadataFileWithLock(
  filePath,
  metadataAdds,
  timeout
) {
  const startTime = Date.now();

  const lockFilePath = `${filePath}.lock`;
  let lockFileHandle;

  while (Date.now() - startTime <= timeout) {
    try {
      lockFileHandle = await fsPromise.open(lockFilePath, "wx");

      await updateXYZMetadataFile(filePath, {
        ...metadataAdds,
        scheme: "xyz",
      });

      await lockFileHandle.close();

      await fsPromise.rm(lockFilePath, {
        force: true,
      });

      return;
    } catch (error) {
      if (error.code === "ENOENT") {
        await fsPromise.mkdir(path.dirname(filePath), {
          recursive: true,
        });

        continue;
      } else if (error.code === "EEXIST") {
        await delay(50);
      } else {
        if (lockFileHandle !== undefined) {
          await lockFileHandle.close();

          await fsPromise.rm(lockFilePath, {
            force: true,
          });
        }

        throw error;
      }
    }
  }

  throw new Error(`Timeout to access lock file`);
}

/**
 * Download XYZ tile data file
 * @param {string} url The URL to download the file from
 * @param {string} sourcePath XYZ folder path
 * @param {sqlite3.Database} xyzSource SQLite database instance
 * @param {number} z Zoom level
 * @param {number} x X tile index
 * @param {number} y Y tile index
 * @param {"jpeg"|"jpg"|"pbf"|"png"|"webp"|"gif"} format Tile format
 * @param {number} maxTry Number of retry attempts on failure
 * @param {number} timeout Timeout in milliseconds
 * @param {boolean} storeMD5 Is store MD5 hashed?
 * @param {boolean} storeTransparent Is store transparent tile?
 * @returns {Promise<void>}
 */
export async function downloadXYZTileDataFile(
  url,
  sourcePath,
  xyzSource,
  z,
  x,
  y,
  format,
  maxTry,
  timeout,
  storeMD5,
  storeTransparent
) {
  const tileName = `${z}/${x}/${y}`;

  printLog("info", `Downloading tile data file "${tileName}" from "${url}"...`);

  try {
    await retry(async () => {
      try {
        // Get data from URL
        const response = await getDataFromURL(url, timeout, "arraybuffer");

        // Store data to file
        if (
          storeTransparent === false &&
          (await isFullTransparentPNGImage(response.data)) === true
        ) {
          return;
        } else {
          await createXYZTileDataFileWithLock(
            `${sourcePath}/${tileName}.${format}`,
            response.data,
            300000 // 5 mins
          );

          // Store data md5 hash
          if (storeMD5 === true) {
            await createXYZTileMD5WithLock(
              xyzSource,
              z,
              x,
              y,
              response.data,
              response.headers["Etag"],
              300000 // 5 mins
            );
          }
        }
      } catch (error) {
        if (error.statusCode !== undefined) {
          printLog(
            "error",
            `Failed to download tile data file "${tileName}" from "${url}": ${error}`
          );

          if (
            error.statusCode === StatusCodes.NO_CONTENT ||
            error.statusCode === StatusCodes.NOT_FOUND
          ) {
            return;
          } else {
            throw new Error(
              `Failed to download tile data file "${tileName}" from "${url}": ${error}`
            );
          }
        } else {
          throw new Error(
            `Failed to download tile data file "${tileName}" from "${url}": ${error}`
          );
        }
      }
    }, maxTry);
  } catch (error) {
    printLog("error", `${error}`);
  }
}

/**
 * Remove XYZ tile data file
 * @param {string} sourcePath XYZ folder path
 * @param {sqlite3.Database} xyzSource SQLite database instance
 * @param {number} z Zoom level
 * @param {number} x X tile index
 * @param {number} y Y tile index
 * @param {"jpeg"|"jpg"|"pbf"|"png"|"webp"|"gif"} format Tile format
 * @param {number} maxTry Number of retry attempts on failure
 * @param {number} timeout Timeout in milliseconds
 * @returns {Promise<void>}
 */
export async function removeXYZTileDataFile(
  sourcePath,
  xyzSource,
  z,
  x,
  y,
  format,
  maxTry,
  timeout
) {
  const tileName = `${z}/${x}/${y}`;

  printLog("info", `Removing tile data file "${tileName}"...`);

  try {
    try {
      await retry(async () => {
        await removeXYZTileDataFileWithLock(
          `${sourcePath}/${tileName}.${format}`,
          timeout
        );

        if (xyzSource !== undefined) {
          await removeXYZTileMD5WithLock(
            xyzSource,
            z,
            x,
            y,
            300000 // 5 mins
          );
        }
      }, maxTry);
    } catch (error) {
      throw new Error(
        `Failed to remove tile data file "${tileName}": ${error}`
      );
    }
  } catch (error) {
    printLog("error", `${error}`);
  }
}

/**
 * Cache XYZ tile data file
 * @param {string} sourcePath XYZ folder path
 * @param {sqlite3.Database} xyzSource SQLite database instance
 * @param {number} z Zoom level
 * @param {number} x X tile index
 * @param {number} y Y tile index
 * @param {"jpeg"|"jpg"|"pbf"|"png"|"webp"|"gif"} format Tile format
 * @param {Buffer} data Tile data buffer
 * @param {string} hash MD5 hash string
 * @param {boolean} storeMD5 Is store MD5 hashed?
 * @param {boolean} storeTransparent Is store transparent tile?
 * @returns {Promise<void>}
 */
export async function cacheXYZTileDataFile(
  sourcePath,
  xyzSource,
  z,
  x,
  y,
  format,
  data,
  hash,
  storeMD5,
  storeTransparent
) {
  const tileName = `${z}/${x}/${y}`;

  printLog("info", `Caching tile data file "${tileName}"...`);

  try {
    if (
      storeTransparent === false &&
      (await isFullTransparentPNGImage(data)) === true
    ) {
      return;
    } else {
      await createXYZTileDataFileWithLock(
        `${sourcePath}/${z}/${x}/${y}.${format}`,
        data,
        300000 // 5 mins
      );

      if (storeMD5 === true) {
        await createXYZTileMD5WithLock(
          xyzSource,
          z,
          x,
          y,
          data,
          hash,
          300000 // 5 mins
        );
      }
    }
  } catch (error) {
    printLog("error", `Failed to cache tile data file "${tileName}": ${error}`);
  }
}

/**
 * Open XYZ MD5 SQLite database
 * @param {string} sourcePath XYZ folder path
 * @param {number} mode SQLite mode (e.g: sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE | sqlite3.OPEN_READONLY)
 * @param {boolean} wal Use WAL
 * @returns {Promise<sqlite3.Database>}
 */
export async function openXYZMD5DB(
  sourcePath,
  mode = sqlite3.OPEN_READONLY,
  wal = false
) {
  const xyzSource = await openSQLite(`${sourcePath}/md5.sqlite`, mode, wal);

  if (mode & sqlite3.OPEN_CREATE) {
    await initializeXYZMD5Tables(xyzSource);
  }

  return xyzSource;
}

/**
 * Close the XYZ MD5 SQLite database
 * @param {sqlite3.Database} xyzSource SQLite database instance
 * @returns {Promise<void>}
 */
export async function closeXYZMD5DB(xyzSource) {
  return await closeSQLite(xyzSource);
}

/**
 * Get MD5 hash of XYZ tile
 * @param {sqlite3.Database} xyzSource SQLite database instance
 * @param {number} z Zoom level
 * @param {number} x X tile index
 * @param {number} y Y tile index
 * @returns {Promise<string>} Returns the MD5 hash as a string
 */
export async function getXYZTileMD5(xyzSource, z, x, y) {
  const data = await fetchOne(
    xyzSource,
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
    y
  );

  if (!data?.hash) {
    throw new Error("Tile MD5 does not exist");
  }

  return data.hash;
}

/**
 * Get created of XYZ tile
 * @param {string} filePath The path of the file
 * @returns {Promise<number>}
 */
export async function getXYZTileCreated(filePath) {
  try {
    const stats = await fsPromise.stat(filePath);

    return stats.ctimeMs;
  } catch (error) {
    if (error === "ENOENT") {
      throw new Error("Tile created does not exist");
    } else {
      throw error;
    }
  }
}
