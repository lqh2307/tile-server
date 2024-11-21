"use strict";

import { deleteXYZTileMD5, updateXYZTileMD5 } from "./md5.js";
import { isFullTransparentPNGImage } from "./image.js";
import { StatusCodes } from "http-status-codes";
import fsPromise from "node:fs/promises";
import { printLog } from "./logger.js";
import { Mutex } from "async-mutex";
import https from "node:https";
import path from "node:path";
import http from "node:http";
import axios from "axios";
import {
  getLayerNamesFromPBFTileBuffer,
  detectFormatAndHeaders,
  getTileBoundsFromBBox,
  getBBoxFromTiles,
  findFolders,
  findFiles,
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
        `Failed to get data tile from "${url}": Status code: ${error.response.status} - ${error.response.statusText}`
      );
    }

    throw new Error(`Failed to get data tile from "${url}": ${error}`);
  }
}

/**
 * Get XYZ layers from tiles
 * @param {string} sourcePath Folder path
 * @returns {Promise<Array<string>>}
 */
export async function getXYZLayersFromTiles(sourcePath) {
  const pbfFilePaths = await findFiles(sourcePath, /^\d+\.pbf$/, true);
  let totalTasks = pbfFilePaths.length;
  const layerNames = new Set();
  let activeTasks = 0;
  const mutex = new Mutex();

  async function updateActiveTasks(action) {
    return await mutex.runExclusive(async () => {
      return action();
    });
  }

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
        const data = await fsPromise.readFile(`${sourcePath}/${pbfFilePath}`);
        const layers = await getLayerNamesFromPBFTileBuffer(data);

        layers.forEach((layer) => layerNames.add(layer));
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
 * @returns {Promise<Array<number>>} Bounding box in format [minLon, minLat, maxLon, maxLat]
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
      metadata.bounds = await getXYZBBoxFromTiles(sourcePath, "xyz");
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
 * Update XYZ metadata.json file
 * @param {string} filePath File path to store metadata.json file
 * @param {Object<string,string>} metadataAdds Metadata object
 * @returns {Promise<void>}
 */
async function updateXYZMetadataFile(filePath, metadataAdds = {}) {
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
 * Update XYZ metadata.json file with lock
 * @param {string} filePath File path to store metadata.json file
 * @param {Object<string,string>} metadataAdds Metadata object
 * @param {number} timeout Timeout in milliseconds
 * @returns {Promise<void>}
 */
export async function updateXYZMetadataFileWithLock(
  filePath,
  metadataAdds = {},
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

  throw new Error(`Timeout to access ${lockFilePath} file`);
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
 * @returns {Promise<boolean>}
 */
export async function createXYZTileDataFileWithLock(filePath, data) {
  const lockFilePath = `${filePath}.lock`;
  let lockFileHandle;

  try {
    lockFileHandle = await fsPromise.open(lockFilePath, "wx");

    await createXYZTileDataFile(filePath, data);

    await lockFileHandle.close();

    await fsPromise.rm(lockFilePath, {
      force: true,
    });

    return true;
  } catch (error) {
    if (error.code === "ENOENT") {
      await fsPromise.mkdir(path.dirname(filePath), {
        recursive: true,
      });

      lockFileHandle = await fsPromise.open(lockFilePath, "wx");

      await createXYZTileDataFile(filePath, data);

      await lockFileHandle.close();

      await fsPromise.rm(lockFilePath, {
        force: true,
      });

      return true;
    } else if (error.code === "EEXIST") {
      return false;
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
        await delay(100);
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

  throw new Error(`Timeout to access ${lockFilePath} file`);
}

/**
 * Download XYZ tile data file
 * @param {string} url The URL to download the file from
 * @param {string} sourcePath Folder path
 * @param {number} z Zoom level
 * @param {number} x X tile index
 * @param {number} y Y tile index
 * @param {"jpeg"|"jpg"|"pbf"|"png"|"webp"|"gif"} format Tile format
 * @param {number} maxTry Number of retry attempts on failure
 * @param {number} timeout Timeout in milliseconds
 * @param {boolean} storeMD5 Is store MD5 hashed?
 * @param {boolean} storeTransparent Is store transparent?
 * @returns {Promise<void>}
 */
export async function downloadXYZTileDataFile(
  url,
  sourcePath,
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

        // Store data to file
        if (
          storeTransparent === false &&
          format === "png" &&
          (await isFullTransparentPNGImage(response.data)) === true
        ) {
          return;
        } else {
          await storeXYZTileDataFileWithLock(
            `${sourcePath}/${tileName}.${format}`,
            response.data,
            300000 // 5 mins
          );

          // Store data md5 hash
          if (storeMD5 === true) {
            updateXYZTileMD5(
              sourcePath,
              z,
              x,
              y,
              response.data,
              response.headers["Etag"],
              180000 // 3 mins
            ).catch((error) =>
              printLog(
                "error",
                `Failed to update md5 for tile "${tileName}": ${error}`
              )
            );
          }
        }
      } catch (error) {
        if (error.response) {
          if (
            error.response.status === StatusCodes.NO_CONTENT ||
            error.response.status === StatusCodes.NOT_FOUND
          ) {
            printLog(
              "error",
              `Failed to download tile data file "${tileName}" from "${url}": Status code: ${error.response.status} - ${error.response.statusText}`
            );

            return;
          } else {
            throw new Error(
              `Failed to download tile data file "${tileName}" from "${url}": Status code: ${error.response.status} - ${error.response.statusText}`
            );
          }
        }

        throw new Error(
          `Failed to download tile data file "${tileName}" from "${url}": ${error}`
        );
      }
    }, maxTry);
  } catch (error) {
    printLog("error", `${error}`);
  }
}

/**
 * Remove XYZ tile data file
 * @param {string} sourcePath Folder path
 * @param {number} z Zoom level
 * @param {number} x X tile index
 * @param {number} y Y tile index
 * @param {"jpeg"|"jpg"|"pbf"|"png"|"webp"|"gif"} format Tile format
 * @param {number} maxTry Number of retry attempts on failure
 * @param {number} timeout Timeout in milliseconds
 * @param {boolean} storeMD5 Is store MD5 hashed?
 * @returns {Promise<void>}
 */
export async function removeXYZTileDataFile(
  sourcePath,
  z,
  x,
  y,
  format,
  maxTry,
  timeout,
  storeMD5
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

        if (storeMD5 === true) {
          deleteXYZTileMD5(
            sourcePath,
            z,
            x,
            y,
            180000 // 3 mins
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
 * Cache tile data file
 * @param {string} sourcePath Folder path
 * @param {number} z Zoom level
 * @param {number} x X tile index
 * @param {number} y Y tile index
 * @param {"jpeg"|"jpg"|"pbf"|"png"|"webp"|"gif"} format Tile format
 * @param {Buffer} data Tile data buffer
 * @param {string} hash MD5 hash string
 * @param {boolean} storeMD5 Is store MD5 hashed?
 * @param {boolean} storeTransparent Is store transparent?
 * @returns {Promise<void>}
 */
export async function cacheXYZTileDataFile(
  sourcePath,
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

  if (
    storeTransparent === false &&
    format === "png" &&
    (await isFullTransparentPNGImage(data)) === true
  ) {
    return;
  } else {
    if (
      (await createXYZTileDataFileWithLock(
        `${sourcePath}/${tileName}.${format}`,
        data
      )) === true
    ) {
      if (storeMD5 === true) {
        updateXYZTileMD5(
          sourcePath,
          z,
          x,
          y,
          data,
          hash,
          180000 // 3 mins
        ).catch((error) =>
          printLog(
            "error",
            `Failed to update md5 for tile "${tileName}": ${error}`
          )
        );
      }
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
