"use strict";

import { StatusCodes } from "http-status-codes";
import fsPromise from "node:fs/promises";
import https from "node:https";
import pLimit from "p-limit";
import path from "node:path";
import http from "node:http";
import axios from "axios";
import {
  getLayerNamesFromPBFTileBuffer,
  detectFormatAndHeaders,
  getTileBoundsFromBBox,
  removeFilesOrFolder,
  createNewTileJSON,
  getBBoxFromTiles,
  calculateMD5,
  findFolders,
  findFiles,
  printLog,
  getData,
} from "./utils.js";

/**
 * Get XYZ tile
 * @param {string} sourcePath
 * @param {number} z
 * @param {number} x
 * @param {number} y
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
    }

    throw error;
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
    const response = await axios.get(url, {
      timeout: timeout,
      responseType: "arraybuffer",
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

    return {
      data: response.data,
      headers: detectFormatAndHeaders(response.data).headers,
      etag: response.headers["Etag"],
    };
  } catch (error) {
    if (error.response) {
      if (
        error.response.status === StatusCodes.NOT_FOUND ||
        error.response.status === StatusCodes.NO_CONTENT
      ) {
        throw new Error("Tile does not exist");
      }

      throw new Error(
        `Failed to request "${url}" with status code: ${error.response.status} - ${error.response.statusText}`
      );
    }

    throw new Error(`Failed to request "${url}": ${error.message}`);
  }
}

/**
 * Get XYZ layers from tiles
 * @param {string} sourcePath
 * @returns {Promise<Array<string>>}
 */
export async function getXYZLayersFromTiles(sourcePath) {
  const pbfFilePaths = await findFiles(sourcePath, /^\d+\.pbf$/, true);
  const limitConcurrencyRead = pLimit(100);
  const layerNames = new Set();

  await Promise.all(
    pbfFilePaths.map((pbfFilePath) =>
      limitConcurrencyRead(async () => {
        try {
          const data = await fsPromise.readFile(`${sourcePath}/${pbfFilePath}`);

          const layers = await getLayerNamesFromPBFTileBuffer(data);

          layers.forEach((layer) => layerNames.add(layer));
        } catch (error) {
          throw error;
        }
      })
    )
  );

  return Array.from(layerNames);
}

/**
 * Get XYZ tile format from tiles
 * @param {string} sourcePath
 * @returns {Promise<number>}
 */
export async function getXYZFormatFromTiles(sourcePath) {
  const zFolders = await findFolders(sourcePath, /^\d+$/, false);

  loop: for (const zFolder of zFolders) {
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
        metadata.format = yFiles[0].split(".")[1];

        break loop;
      }
    }
  }
}

/**
 * Get XYZ bounding box from tiles
 * @param {string} sourcePath
 * @returns {Promise<number>}
 */
export async function getXYZBBoxFromTiles(sourcePath) {
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
    metadata.bounds = [
      Math.min(...boundsArr.map((bbox) => bbox[0])),
      Math.min(...boundsArr.map((bbox) => bbox[1])),
      Math.max(...boundsArr.map((bbox) => bbox[2])),
      Math.max(...boundsArr.map((bbox) => bbox[3])),
    ];
  }
}

/**
 * Get XYZ zoom level from tiles
 * @param {string} sourcePath
 * @param {"minzoom"|"maxzoom"} zoomType
 * @returns {Promise<number>}
 */
export async function getXYZZoomLevelFromTiles(
  sourcePath,
  zoomType = "maxzoom"
) {
  const folders = await findFolders(sourcePath, /^\d+$/, false);

  return zoomType === "minzoom"
    ? Math.min(...folders.map((folder) => Number(folder)))
    : Math.max(...folders.map((folder) => Number(folder)));
}

/**
 * Get XYZ infos
 * @param {string} sourcePath
 * @returns {Promise<object>}
 */
export async function getXYZInfos(sourcePath) {
  let metadata = {};

  /* Get metadatas */
  try {
    metadata = JSON.parse(
      await fsPromise.readFile(`${sourcePath}/metadata.json`, "utf8")
    );
  } catch (error) {}

  /* Try get min zoom */
  if (metadata.minzoom === undefined) {
    metadata.minzoom = await getXYZZoomLevelFromTiles(sourcePath, "minzoom");
  }

  /* Try get max zoom */
  if (metadata.maxzoom === undefined) {
    metadata.maxzoom = await getXYZZoomLevelFromTiles(sourcePath, "maxzoom");
  }

  /* Try get tile format */
  if (metadata.format === undefined) {
    metadata.format = await getXYZFormatFromTiles(sourcePath);
  }

  /* Try get bounds */
  if (metadata.bounds === undefined) {
    metadata.bounds = await getXYZBBoxFromTiles(sourcePath, "xyz");
  }

  /* Add vector_layers */
  if (metadata.format === "pbf" && metadata.vector_layers === undefined) {
    const layers = await getXYZLayersFromTiles(sourcePath);

    metadata.vector_layers = layers.map((layer) => {
      return {
        id: layer,
      };
    });
  }

  return createNewTileJSON(metadata);
}

/**
 * Create XYZ metadata.json file
 * @param {string} outputFolder Folder path to store metadata.json file
 * @param {Object<string,string>} metadatas Metadata object
 * @returns {Promise<void>}
 */
export async function createXYZMetadataFile(outputFolder, metadatas) {
  await fsPromise.mkdir(outputFolder, {
    recursive: true,
  });

  await fsPromise.writeFile(
    `${outputFolder}/metadata.json`,
    JSON.stringify(metadatas, null, 2),
    "utf8"
  );
}

/**
 * Create XYZ md5.json file
 * @param {string} outputFolder Folder path to store md5.json file
 * @param {Object<string,string>} hashs Hash data object
 * @returns {Promise<void>}
 */
export async function createXYZMD5File(outputFolder, hashs) {
  await fsPromise.mkdir(outputFolder, {
    recursive: true,
  });

  await fsPromise.writeFile(
    `${outputFolder}/md5.json`,
    JSON.stringify(hashs, null, 2),
    "utf8"
  );
}

/**
 * Update XYZ md5.json file
 * @param {string} outputFolder Folder path to store md5.json file
 * @param {string} key
 * @param {string} value
 * @returns {Promise<void>}
 */
export async function updateXYZMD5File(outputFolder, key, value) {
  try {
    const hashs = JSON.parse(
      await fsPromise.readFile(`${outputFolder}/md5.json`, "utf8")
    );

    hashs[key] = value;

    await fsPromise.writeFile(JSON.stringify(hashs, null, 2), "utf8");
  } catch (error) {
    if (error.code === "ENOENT") {
      await fsPromise.mkdir(outputFolder, {
        recursive: true,
      });

      await fsPromise.writeFile(
        `${outputFolder}/md5.json`,
        JSON.stringify(
          {
            [key]: value,
          },
          null,
          2
        ),
        "utf8"
      );
    } else {
      throw error;
    }
  }
}

/**
 * Update XYZ md5.json file with lock
 * @param {string} sourcePath Folder path to store md5.json file
 * @param {string} key
 * @param {string} value
 * @param {number} timeout Timeout in milliseconds
 * @returns {Promise<void>}
 */
export async function updateXYZMD5FileWithLock(
  sourcePath,
  key,
  value,
  timeout
) {
  const startTime = Date.now();
  let lockFileID;

  while (Date.now() - startTime <= timeout) {
    try {
      lockFileID = fs.openSync(`${sourcePath}/md5.json.lock`, "wx");

      await updateXYZMD5File(sourcePath, key, value);
    } catch (error) {
      if (error.code === "EEXIST") {
        await delay(100);
      } else {
        throw error;
      }
    } finally {
      fs.closeSync(lockFileID);

      await removeFilesOrFolder(`${sourcePath}/md5.json.lock`);
    }
  }

  printLog(
    "error",
    `Failed to update md5 for tile data file "${key}": Failed to acquire exclusive access to file ${filePath}: Timeout exceeded`
  );
}

/**
 * Create tile data file
 * @param {string} filePath File path to store tile data file
 * @param {Buffer} data Tile data buffer
 * @returns {Promise<void>}
 */
export async function createXYZTileDataFile(filePath, data) {
  await fsPromise.mkdir(path.dirname(filePath), {
    recursive: true,
  });

  await fsPromise.writeFile(filePath, data);
}

/**
 * Download XYZ tile data file
 * @param {string} url The URL to download the file from
 * @param {string} sourcePath
 * @param {string} tileName
 * @param {"jpeg"|"jpg"|"pbf"|"png"|"webp"|"gif"} format Tile format
 * @param {number} maxTry Number of retry attempts on failure
 * @param {number} timeout Timeout in milliseconds
 * @param {object} hashs
 * @returns {Promise<void>}
 */
export async function downloadXYZTileDataFile(
  url,
  sourcePath,
  tileName,
  format,
  maxTry,
  timeout,
  hashs
) {
  const filePath = `${sourcePath}/${tileName}.${format}`;

  try {
    printLog(
      "info",
      `Downloading tile data file "${tileName}" from "${url}"...`
    );

    await retry(async () => {
      // Get data
      const response = await getData(url, timeout);

      // Store data to file
      await createXYZTileDataFile(filePath, response.data);

      // Store data md5 hash
      hashs[tileName] =
        response.headers["Etag"] === undefined
          ? calculateMD5(response.data)
          : response.headers["Etag"];
    }, maxTry);
  } catch (error) {
    printLog(
      "error",
      `Failed to download tile data file "${tileName}" from "${url}": ${error}`
    );

    // Remove error tile data file
    await removeFilesOrFolder(filePath);
  }
}

/**
 * Remove XYZ tile data file
 * @param {string} sourcePath
 * @param {string} tileName
 * @param {"jpeg"|"jpg"|"pbf"|"png"|"webp"|"gif"} format Tile format
 * @param {number} maxTry Number of retry attempts on failure
 * @param {object} hashs
 * @returns {Promise<void>}
 */
export async function removeXYZTileDataFile(
  sourcePath,
  tileName,
  format,
  maxTry,
  hashs
) {
  const filePath = `${sourcePath}/${tileName}.${format}`;

  try {
    printLog("info", `Removing tile data file "${tileName}"...`);

    await retry(async () => {
      await removeFilesOrFolder(filePath);

      delete hashs[tileName];
    }, maxTry);
  } catch (error) {
    printLog(
      "error",
      `Failed to remove tile data file "${tileName}": ${error}`
    );
  }
}

/**
 * Cache tile data file
 * @param {string} sourcePath
 * @param {string} tileName
 * @param {"jpeg"|"jpg"|"pbf"|"png"|"webp"|"gif"} format Tile format
 * @param {Buffer} data Tile data buffer
 * @param {object} cacheItemLock Cache item lock
 * @param {string} md5
 * @returns {Promise<void>}
 */
export async function cacheXYZTileDataFile(
  sourcePath,
  tileName,
  format,
  data,
  cacheItemLock,
  md5
) {
  if (cacheItemLock[tileName] === undefined) {
    // Lock
    cacheItemLock[tileName] = true;

    const filePath = `${sourcePath}/${tileName}.${format}`;

    try {
      await createXYZTileDataFile(filePath, data);

      updateXYZMD5FileWithLock(
        sourcePath,
        tileName,
        md5 === undefined ? calculateMD5(data) : md5,
        300000 // 5 mins
      );
    } catch (error) {
      throw error;
    } finally {
      // Unlock
      delete cacheItemLock[tileName];
    }
  }
}

/**
 * Get XYZ tile from bounding box for specific zoom levels intersecting a bounding box
 * @param {Array<number>} bbox [west, south, east, north] in EPSG:4326
 * @param {Array<number>} zooms Array of specific zoom levels
 * @returns {Array<string>} Array values as z/x/y
 */
export function getXYZTileFromBBox(bbox, zooms) {
  const tilesSummary = getTileBoundsFromBBox(bbox, zooms, "xyz");
  const tiles = [];

  for (const z in tilesSummary) {
    for (let x = tilesSummary[z].x[0]; x <= tilesSummary[z].x[1]; x++) {
      for (let y = tilesSummary[z].y[0]; y <= tilesSummary[z].y[1]; y++) {
        tiles.push(`/${z}/${x}/${y}`);
      }
    }
  }

  return tiles;
}

/**
 * Get XYZ tile MD5
 * @param {string} sourcePath
 * @param {number} z
 * @param {number} x
 * @param {number} y
 * @param {"jpeg"|"jpg"|"pbf"|"png"|"webp"|"gif"} format Tile format
 * @returns {Promise<string>}
 */
export async function getXYZTileMD5(sourcePath, z, x, y, format) {
  try {
    const hashs = JSON.parse(
      await fsPromise.readFile(`${sourcePath}/md5.json`)
    );

    if (hashs[`${z}/${x}/${y}`] === undefined) {
      throw new Error("Tile MD5 does not exist");
    }
  } catch (error) {
    if (error.code === "ENOENT") {
      try {
        let data = await fsPromise.readFile(
          `${sourcePath}/${z}/${x}/${y}.${format}`
        );

        if (!data) {
          throw new Error("Tile MD5 does not exist");
        }

        return calculateMD5(Buffer.from(data));
      } catch (error) {
        if (error.code === "ENOENT") {
          throw new Error("Tile MD5 does not exist");
        }

        throw error;
      }
    }

    throw error;
  }
}
