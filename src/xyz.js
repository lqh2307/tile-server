"use strict";

import { StatusCodes } from "http-status-codes";
import fsPromise from "node:fs/promises";
import { printLog } from "./logger.js";
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
  getData,
  delay,
  retry,
} from "./utils.js";

/**
 * Get XYZ tile
 * @param {string} sourcePath Folder path
 * @param {number} z Zoom level
 * @param {number} x X tile index
 * @param {number} y Y tile index
 * @param {"jpeg"|"jpg"|"pbf"|"png"|"webp"|"gif"} format Tile format
 * @returns {Promise<object>}
 */
export async function getXYZTile(sourcePath, z, x, y, format) {
  const filePath = `${sourcePath}/${z}/${x}/${y}.${format}`;

  try {
    let data = await fsPromise.readFile(filePath);
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
 * @param {string} sourcePath Folder path
 * @returns {Promise<Array<string>>}
 */
export async function getXYZLayersFromTiles(sourcePath) {
  const pbfFilePaths = await findFiles(sourcePath, /^\d+\.pbf$/, true);
  const limitConcurrencyRead = pLimit(200);
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
 * @param {string} sourcePath Folder path
 * @returns {Promise<string>}
 */
export async function getXYZFormatFromTiles(sourcePath) {
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
 * @param {string} sourcePath Folder path
 * @returns {Promise<Array<number>>}
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
 * @param {string} sourcePath Folder path
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
 * @param {string} sourcePath Folder path
 * @returns {Promise<object>}
 */
export async function getXYZInfos(sourcePath) {
  let metadata = {};

  /* Get metadatas */
  try {
    const data = await fsPromise.readFile(
      `${sourcePath}/metadata.json`,
      "utf8"
    );

    metadata = JSON.parse(data);
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
 * Update XYZ metadata.json file
 * @param {string} filePath File path to store metadata.json file
 * @param {Object<string,string>} metadataAdds Metadata object
 * @returns {Promise<void>}
 */
export async function updateXYZMetadataFile(filePath, metadataAdds) {
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
      await removeFilesOrFolder(tempFilePath);

      throw error;
    }
  }
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

      await updateXYZMetadataFile(filePath, metadataAdds);

      await lockFileHandle.close();

      await removeFilesOrFolder(lockFilePath);

      return;
    } catch (error) {
      if (error.code === "ENOENT") {
        await fsPromise.mkdir(path.dirname(filePath), {
          recursive: true,
        });

        await updateXYZMetadataFileWithLock(filePath, metadataAdds, timeout);

        return;
      } else if (error.code === "EEXIST") {
        await delay(50);
      } else {
        if (lockFileHandle !== undefined) {
          await lockFileHandle.close();

          await removeFilesOrFolder(lockFilePath);
        }

        throw error;
      }
    }
  }

  throw new Error(`Timeout to access ${lockFilePath} file`);
}

/**
 * Update XYZ md5.json file
 * @param {string} filePath File path to store md5.json file
 * @param {Object<string,string>} hashAdds Hash data object
 * @returns {Promise<void>}
 */
export async function updateXYZMD5File(filePath, hashAdds) {
  const tempFilePath = `${filePath}.tmp`;

  try {
    const hashs = JSON.parse(await fsPromise.readFile(filePath, "utf8"));

    await fsPromise.writeFile(
      tempFilePath,
      JSON.stringify(
        {
          ...hashs,
          ...hashAdds,
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
        JSON.stringify(hashAdds, null, 2),
        "utf8"
      );
    } else {
      await removeFilesOrFolder(tempFilePath);

      throw error;
    }
  }
}

/**
 * Update XYZ md5.json file with lock
 * @param {string} filePath File path to store md5.json file
 * @param {Object<string,string>} hashAdds Hash data object
 * @param {number} timeout Timeout in milliseconds
 * @returns {Promise<void>}
 */
export async function updateXYZMD5FileWithLock(filePath, hashAdds, timeout) {
  const startTime = Date.now();
  const lockFilePath = `${filePath}.lock`;
  let lockFileHandle;

  while (Date.now() - startTime <= timeout) {
    try {
      lockFileHandle = await fsPromise.open(lockFilePath, "wx");

      await updateXYZMD5File(filePath, hashAdds);

      await lockFileHandle.close();

      await removeFilesOrFolder(lockFilePath);

      return;
    } catch (error) {
      if (error.code === "ENOENT") {
        await fsPromise.mkdir(path.dirname(filePath), {
          recursive: true,
        });

        await updateXYZMD5FileWithLock(filePath, hashAdds, timeout);

        return;
      } else if (error.code === "EEXIST") {
        await delay(50);
      } else {
        if (lockFileHandle !== undefined) {
          await lockFileHandle.close();

          await removeFilesOrFolder(lockFilePath);
        }

        throw error;
      }
    }
  }

  throw new Error(`Timeout to access ${lockFilePath} file`);
}

/**
 * Create XYZ tile data file
 * @param {string} filePath File path to store tile data file
 * @param {Buffer} data Tile data buffer
 * @returns {Promise<void>}
 */
export async function createXYZTileDataFile(filePath, data) {
  const tempFilePath = `${filePath}.tmp`;

  try {
    await fsPromise.mkdir(path.dirname(filePath), {
      recursive: true,
    });

    await fsPromise.writeFile(tempFilePath, data);

    await fsPromise.rename(tempFilePath, filePath);
  } catch (error) {
    await removeFilesOrFolder(tempFilePath);

    throw error;
  }
}

/**
 * Create XYZ tile data file with lock
 * @param {string} filePath File path to store tile data file
 * @param {Buffer} data Tile data buffer
 * @returns {Promise<boolean>}
 */
export async function createXYZTileDataFileWithLock(filePath, data) {
  const lockFilePath = `${filePath}.lock`;
  let lockFileHandle;

  try {
    lockFileHandle = await fsPromise.open(lockFilePath, "wx");

    await createXYZTileDataFile(filePath, data);

    await lockFileHandle.close();

    await removeFilesOrFolder(lockFilePath);

    return true;
  } catch (error) {
    if (error.code === "ENOENT") {
      await fsPromise.mkdir(path.dirname(filePath), {
        recursive: true,
      });

      return await createXYZTileDataFileWithLock(filePath, data);
    } else if (error.code === "EEXIST") {
      return false;
    } else {
      if (lockFileHandle !== undefined) {
        await lockFileHandle.close();

        await removeFilesOrFolder(lockFilePath);
      }

      throw error;
    }
  }
}

/**
 * Store XYZ tile data file with lock
 * @param {string} filePath File path to store tile data file
 * @param {Buffer} data Tile data buffer
 * @param {number} timeout Timeout in milliseconds
 * @returns {Promise<void>}
 */
export async function storeXYZTileDataFileWithLock(filePath, data, timeout) {
  const startTime = Date.now();
  const lockFilePath = `${filePath}.lock`;
  let lockFileHandle;

  while (Date.now() - startTime <= timeout) {
    try {
      lockFileHandle = await fsPromise.open(lockFilePath, "wx");

      await createXYZTileDataFile(filePath, data);

      await lockFileHandle.close();

      await removeFilesOrFolder(lockFilePath);

      return;
    } catch (error) {
      if (error.code === "ENOENT") {
        await fsPromise.mkdir(path.dirname(filePath), {
          recursive: true,
        });

        return await storeXYZTileDataFileWithLock(filePath, data, timeout);
      } else if (error.code === "EEXIST") {
        await delay(100);
      } else {
        if (lockFileHandle !== undefined) {
          await lockFileHandle.close();

          await removeFilesOrFolder(lockFilePath);
        }

        throw error;
      }
    }
  }

  throw new Error(`Timeout to access ${lockFilePath} file`);
}

/**
 * Remove XYZ tile data file with lock
 * @param {string} filePath File path to remove tile data file
 * @param {number} timeout Timeout in milliseconds
 * @returns {Promise<void>}
 */
export async function removeXYZTileDataFileWithLock(filePath, timeout) {
  const startTime = Date.now();
  const lockFilePath = `${filePath}.lock`;
  let lockFileHandle;

  while (Date.now() - startTime <= timeout) {
    try {
      lockFileHandle = await fsPromise.open(lockFilePath, "wx");

      await removeFilesOrFolder(filePath);

      await lockFileHandle.close();

      await removeFilesOrFolder(lockFilePath);

      return;
    } catch (error) {
      if (error.code === "ENOENT") {
        return;
      } else if (error.code === "EEXIST") {
        await delay(50);
      } else {
        if (lockFileHandle !== undefined) {
          await lockFileHandle.close();

          await removeFilesOrFolder(lockFilePath);
        }

        throw error;
      }
    }
  }

  throw new Error(`Timeout to access ${lockFilePath} file`);
}

/**
 * Download XYZ tile data file
 * @param {string} url The URL to download the file from
 * @param {string} sourcePath Folder path
 * @param {string} tileName Tile name
 * @param {"jpeg"|"jpg"|"pbf"|"png"|"webp"|"gif"} format Tile format
 * @param {number} maxTry Number of retry attempts on failure
 * @param {number} timeout Timeout in milliseconds
 * @param {object} hashs Hash data object
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
  printLog("info", `Downloading tile data file "${tileName}" from "${url}"...`);

  try {
    await retry(async () => {
      // Get data
      const response = await getData(url, timeout);

      if (response.status === StatusCodes.NO_CONTENT) {
        printLog(
          "error",
          `Failed to download tile data file "${tileName}" from "${url}": Status code: ${response.status} - ${response.statusText}`
        );

        return;
      }

      // Store data to file
      await storeXYZTileDataFileWithLock(
        `${sourcePath}/${tileName}.${format}`,
        response.data,
        300000 // 5 mins
      );

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
  }
}

/**
 * Remove XYZ tile data file
 * @param {string} sourcePath Folder path
 * @param {string} tileName Tile name
 * @param {"jpeg"|"jpg"|"pbf"|"png"|"webp"|"gif"} format Tile format
 * @param {number} maxTry Number of retry attempts on failure
 * @param {number} timeout Timeout in milliseconds
 * @param {object} hashs Hash data object
 * @returns {Promise<void>}
 */
export async function removeXYZTileDataFile(
  sourcePath,
  tileName,
  format,
  maxTry,
  timeout,
  hashs
) {
  printLog("info", `Removing tile data file "${tileName}"...`);

  try {
    await retry(async () => {
      await removeXYZTileDataFileWithLock(
        `${sourcePath}/${tileName}.${format}`,
        timeout
      );

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
 * @param {string} sourcePath Folder path
 * @param {string} tileName Tile name
 * @param {"jpeg"|"jpg"|"pbf"|"png"|"webp"|"gif"} format Tile format
 * @param {Buffer} data Tile data buffer
 * @param {string} md5 MD5 hash string
 * @returns {Promise<void>}
 */
export async function cacheXYZTileDataFile(
  sourcePath,
  tileName,
  format,
  data,
  md5
) {
  const filePath = `${sourcePath}/${tileName}.${format}`;

  try {
    if ((await createXYZTileDataFileWithLock(filePath, data)) === true) {
      const md5FilePath = `${sourcePath}/md5.json`;

      updateXYZMD5FileWithLock(
        md5FilePath,
        {
          [tileName]: md5 === undefined ? calculateMD5(data) : md5,
        },
        300000 // 5 mins
      ).catch((error) => {
        printLog(
          "error",
          `Failed to update md5 for tile "${tileName}": ${error}`
        );
      });
    }
  } catch (error) {
    throw error;
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
 * @param {string} sourcePath Folder path
 * @param {number} z Zoom level
 * @param {number} x X tile index
 * @param {number} y Y tile index
 * @param {"jpeg"|"jpg"|"pbf"|"png"|"webp"|"gif"} format Tile format
 * @returns {Promise<string>}
 */
export async function getXYZTileMD5(sourcePath, z, x, y, format) {
  try {
    const data = await fsPromise.readFile(`${sourcePath}/md5.json`);

    const hashs = JSON.parse(data);

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
