"use strict";

import { StatusCodes } from "http-status-codes";
import fsPromise from "node:fs/promises";
import protobuf from "protocol-buffers";
import { printLog } from "./logger.js";
import https from "node:https";
import http from "node:http";
import path from "node:path";
import crypto from "crypto";
import axios from "axios";
import fs from "node:fs";
import zlib from "zlib";
import util from "util";
import Ajv from "ajv";

const vectorTileProto = protobuf(
  fs.readFileSync("public/protos/vector_tile.proto")
);

/**
 * Extracts layer names from a vector tile PBF buffer
 * @param {Buffer} pbfData - The PBF data buffer
 * @returns {Promise<Array<string>} - A promise that resolves to an array of layer names
 */
export async function getLayerNamesFromPBFTileBuffer(pbfData) {
  const decoded = vectorTileProto.tile.decode(pbfData);

  return decoded.layers.map((layer) => layer.name);
}

/**
 * Get data tile from a URL
 * @param {string} url The URL to fetch data from
 * @param {number} timeout Timeout in milliseconds
 * @returns {Promise<object>}
 */
export async function getDataTileFromURL(url, timeout) {
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
        `Status code: ${error.response.status} - ${error.response.statusText}`
      );
    }

    throw error;
  }
}

/**
 * Get data buffer from a URL
 * @param {string} url The URL to fetch data from
 * @param {number} timeout Timeout in milliseconds
 * @returns {Promise<object>}
 */
export async function getDataBuffer(url, timeout) {
  try {
    const response = await axios.get(url, {
      timeout: timeout,
      responseType: "arraybuffer",
      headers: {
        "User-Agent": "Tile Server",
      },
      httpAgent: new http.Agent({
        keepAlive: false,
      }),
      httpsAgent: new https.Agent({
        keepAlive: false,
      }),
    });

    return response;
  } catch (error) {
    if (error.response) {
      throw new Error(
        `Status code: ${error.response.status} - ${error.response.statusText}`
      );
    }

    throw error;
  }
}

/**
 * Check ready middleware
 * @returns {void}
 */
export function checkReadyMiddleware() {
  return async (req, res, next) => {
    try {
      if (process.env.STARTING_UP === undefined) {
        return res.status(StatusCodes.SERVICE_UNAVAILABLE).send("Starting...");
      }

      next();
    } catch (error) {
      printLog("error", `Failed to check ready server: ${error}`);

      return res
        .status(StatusCodes.INTERNAL_SERVER_ERROR)
        .send("Internal server error");
    }
  };
}

/**
 * Get xyz tile indices from longitude, latitude, and zoom level (tile size = 256)
 * @param {number} lon Longitude in EPSG:4326
 * @param {number} lat Latitude in EPSG:4326
 * @param {number} z Zoom level
 * @param {"xyz"|"tms"} scheme Tile scheme
 * @returns {Array<number>} Tile indices [x, y, z]
 */
export function getXYZFromLonLatZ(lon, lat, z, scheme = "xyz") {
  const size = 256 * Math.pow(2, z);
  const bc = size / 360;
  const cc = size / (2 * Math.PI);
  const zc = size / 2;
  const maxTileIndex = Math.pow(2, z) - 1;

  if (lon > 180) {
    lon = 180;
  } else if (lon < -180) {
    lon = -180;
  }

  const px = zc + lon * bc;
  let x = Math.floor(px / 256);
  if (x < 0) {
    x = 0;
  } else if (x > maxTileIndex) {
    x = maxTileIndex;
  }

  if (lat > 85.051129) {
    lat = 85.051129;
  } else if (lat < -85.051129) {
    lat = -85.051129;
  }

  let py = zc - cc * Math.log(Math.tan(Math.PI / 4 + lat * (Math.PI / 360)));
  if (scheme === "tms") {
    py = size - py;
  }

  let y = Math.floor(py / 256);
  if (y < 0) {
    y = 0;
  } else if (y > maxTileIndex) {
    y = maxTileIndex;
  }

  return [x, y, z];
}

/**
 * Get longitude, latitude from tile indices x, y, and zoom level (tile size = 256)
 * @param {number} x X tile index
 * @param {number} y Y tile index
 * @param {number} z Zoom level
 * @param {"center"|"topLeft"|"bottomRight"} position Tile position: "center", "topLeft", or "bottomRight"
 * @param {"xyz"|"tms"} scheme Tile scheme
 * @returns {Array<number>} [longitude, latitude] in EPSG:4326
 */
export function getLonLatFromXYZ(
  x,
  y,
  z,
  position = "topLeft",
  scheme = "xyz"
) {
  const size = 256 * Math.pow(2, z);
  const bc = size / 360;
  const cc = size / (2 * Math.PI);
  const zc = size / 2;

  let px = x * 256;
  let py = y * 256;

  if (position === "center") {
    px = (x + 0.5) * 256;
    py = (y + 0.5) * 256;
  } else if (position === "bottomRight") {
    px = (x + 1) * 256;
    py = (y + 1) * 256;
  }

  if (scheme === "tms") {
    py = size - py;
  }

  return [
    (px - zc) / bc,
    (360 / Math.PI) * (Math.atan(Math.exp((zc - py) / cc)) - Math.PI / 4),
  ];
}

/**
 * Get tile bounds for specific zoom levels intersecting a bounding box
 * @param {Array<number>} bbox [west, south, east, north] in EPSG:4326
 * @param {Array<number>} zooms Array of specific zoom levels
 * @param {"xyz"|"tms"} scheme Tile scheme
 * @returns {Object} Object with keys as zoom levels and values as {x: [min, max], y: [min, max]}
 */
export function getTileBoundsFromBBox(bbox, zooms, scheme) {
  const tilesSummary = {};

  for (const zoom of zooms) {
    const [xMin, yMin] = getXYZFromLonLatZ(bbox[0], bbox[3], zoom, scheme);
    const [xMax, yMax] = getXYZFromLonLatZ(bbox[2], bbox[1], zoom, scheme);

    tilesSummary[`${zoom}`] = {
      x: [xMin, xMax],
      y: [yMin, yMax],
    };
  }

  return tilesSummary;
}

/**
 * Convert tile indices to a bounding box that intersects the outer tiles
 * @param {number} xMin Minimum x tile index
 * @param {number} yMin Minimum y tile index
 * @param {number} xMax Maximum x tile index
 * @param {number} yMax Maximum y tile index
 * @param {number} z Zoom level
 * @param {"xyz"|"tms"} scheme Tile scheme
 * @returns {Array<number>} Bounding box [lonMin, latMin, lonMax, latMax] in EPSG:4326
 */
export function getBBoxFromTiles(xMin, yMin, xMax, yMax, z, scheme = "xyz") {
  const [lonMin, latMax] = getLonLatFromXYZ(xMin, yMin, z, "topLeft", scheme);
  const [lonMax, latMin] = getLonLatFromXYZ(
    xMax,
    yMax,
    z,
    "bottomRight",
    z,
    scheme
  );

  return [lonMin, latMin, lonMax, latMax];
}

/**
 * Delay function to wait for a specified time
 * @param {number} ms Time to wait in milliseconds
 * @returns {Promise<void>}
 */
export function delay(ms) {
  if (ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

/**
 * Attempt do function multiple times
 * @param {function} fn The function to attempt
 * @param {number} maxTry The number of maxTry allowed
 * @param {number} after Delay in milliseconds between each retry
 * @returns {Promise<void>}
 */
export async function retry(fn, maxTry, after = 0) {
  for (let attempt = 1; attempt <= maxTry; attempt++) {
    try {
      return await fn();
    } catch (error) {
      const remainingAttempts = maxTry - attempt;
      if (remainingAttempts > 0) {
        printLog(
          "warning",
          `${error}. ${remainingAttempts} tries remaining - After ${after} ms...`
        );

        await delay(after);
      } else {
        throw error;
      }
    }
  }
}

/**
 * Recursively removes empty folders in a directory
 * @param {string} folderPath The root directory to check for empty folders
 * @param {RegExp} regex The regex to match files
 * @returns {Promise<void>}
 */
export async function removeEmptyFolders(folderPath, regex) {
  const entries = await fsPromise.readdir(folderPath, {
    withFileTypes: true,
  });

  let hasMatchingFile = false;

  await Promise.all(
    entries.map(async (entry) => {
      const fullPath = `${folderPath}/${entry.name}`;

      if (entry.isFile() === true && regex.test(entry.name) === true) {
        hasMatchingFile = true;
      } else if (entry.isDirectory() === true) {
        await removeEmptyFolders(fullPath, regex);

        const subEntries = await fsPromise.readdir(fullPath).catch(() => []);
        if (subEntries.length > 0) {
          hasMatchingFile = true;
        }
      }
    })
  );

  if (hasMatchingFile === false) {
    await fsPromise.rm(folderPath, {
      recursive: true,
      force: true,
    });
  }
}

/**
 * Recursively removes old cache locks
 * @param {string} dataDir The data directory
 * @returns {Promise<void>}
 */
export async function removeOldCacheLocks(dataDir) {
  const cacheDir = `${dataDir}/caches`;

  const fileNames = await findFiles(cacheDir, /^.*\.(lock|tmp)$/, true);

  await Promise.all(
    fileNames.map((fileName) => fsPromise.rm(`${cacheDir}/${fileName}`), {
      force: true,
    })
  );
}

/**
 * Check folder is exist?
 * @param {string} dirPath
 * @returns {Promise<boolean>}
 */
export async function isExistFolder(dirPath) {
  try {
    const stat = await fsPromise.stat(dirPath);

    return stat.isDirectory();
  } catch (error) {
    if (error.code === "ENOENT") {
      return false;
    }

    throw error;
  }
}

/**
 * Check file is exist?
 * @param {string} filePath
 * @returns {Promise<boolean>}
 */
export async function isExistFile(filePath) {
  try {
    const stat = await fsPromise.stat(filePath);

    return stat.isFile();
  } catch (error) {
    if (error.code === "ENOENT") {
      return false;
    }

    throw error;
  }
}

/**
 * Find matching files in a directory
 * @param {string} dirPath The directory path to search
 * @param {RegExp} regex The regex to match files
 * @param {boolean} recurse Whether to search recursively in subdirectories
 * @returns {Promise<string>} Array of file paths matching the regex
 */
export async function findFiles(dirPath, regex, recurse = false) {
  const entries = await fsPromise.readdir(dirPath, {
    withFileTypes: true,
  });

  const results = [];

  for (const entry of entries) {
    if (entry.isFile() === true && regex.test(entry.name) === true) {
      results.push(entry.name);
    } else if (entry.isDirectory() === true && recurse === true) {
      const fileNames = await findFiles(
        `${dirPath}/${entry.name}`,
        regex,
        recurse
      );

      results.push(...fileNames.map((fileName) => `${entry.name}/${fileName}`));
    }
  }

  return results;
}

/**
 * Find matching folders in a directory
 * @param {string} dirPath The directory path to search
 * @param {RegExp} regex The regex to match folders
 * @param {boolean} recurse Whether to search recursively in subdirectories
 * @returns {Promise<string>} Array of folder paths matching the regex
 */
export async function findFolders(dirPath, regex, recurse = false) {
  const entries = await fsPromise.readdir(dirPath, {
    withFileTypes: true,
  });

  const results = [];

  for (const entry of entries) {
    if (entry.isDirectory() === true) {
      if (regex.test(entry.name) === true) {
        results.push(entry.name);
      }

      if (recurse === true) {
        const directoryNames = await findFolders(
          `${dirPath}/${entry.name}`,
          regex,
          recurse
        );

        results.push(
          ...directoryNames.map(
            (directoryName) => `${entry.name}/${directoryName}`
          )
        );
      }
    }
  }

  return results;
}

/**
 * Remove files or folders
 * @param {Array<string>} fileOrFolders File or folder paths
 * @returns {Promise<void>}
 */
export async function removeFilesOrFolders(fileOrFolders) {
  await Promise.all(
    fileOrFolders.map((fileOrFolder) =>
      fsPromise.rm(fileOrFolder, {
        force: true,
        recursive: true,
      })
    )
  );
}

/**
 * Get request host
 * @param {Request} req
 * @returns {string}
 */
export function getRequestHost(req) {
  return `${req.protocol}://${req.headers.host}/`;
}

/**
 * Create new tileJSON
 * @param {object} metadata
 * @returns
 */
export function createMetadata(metadata) {
  // Default
  const data = {
    name: "Unknown",
    description: "Unknown",
    attribution: "<b>Viettel HighTech</b>",
    version: "1.0.0",
    type: "overlay",
    format: "png",
    bounds: [-180, -85.051129, 180, 85.051129],
    minzoom: 0,
    maxzoom: 22,
  };

  // Overwrite
  if (metadata !== undefined) {
    if (metadata.name !== undefined) {
      data.name = metadata.name;
    }

    if (metadata.description !== undefined) {
      data.description = metadata.description;
    }

    if (metadata.attribution !== undefined) {
      data.attribution = metadata.attribution;
    }

    if (metadata.type !== undefined) {
      data.type = metadata.type;
    }

    if (metadata.format !== undefined) {
      data.format = metadata.format;
    }

    if (metadata.version !== undefined) {
      data.version = metadata.version;
    }

    if (metadata.tiles !== undefined) {
      data.tiles = [...metadata.tiles];
    }

    if (metadata.bounds !== undefined) {
      data.bounds = [...metadata.bounds];
    }

    if (metadata.center !== undefined) {
      data.center = [...metadata.center];
    }

    if (metadata.minzoom !== undefined) {
      data.minzoom = metadata.minzoom;
    }

    if (metadata.maxzoom !== undefined) {
      data.maxzoom = metadata.maxzoom;
    }

    if (metadata.vector_layers !== undefined) {
      data.vector_layers = deepClone(metadata.vector_layers);
    }

    if (metadata.tilestats !== undefined) {
      data.tilestats = deepClone(metadata.tilestats);
    }
  }

  // Calculate center
  if (data.center === undefined) {
    data.center = [
      (data.bounds[0] + data.bounds[2]) / 2,
      (data.bounds[1] + data.bounds[3]) / 2,
      Math.floor((data.minzoom + data.maxzoom) / 2),
    ];
  }

  // Add vector_layers
  if (data.format === "pbf" && data.vector_layers === undefined) {
    data.vector_layers = [];
  }

  return data;
}

/**
 * Return either a format as an extension: png, pbf, jpg, webp, gif and
 * headers - Content-Type and Content-Encoding - for a response containing this kind of image
 * @param {Buffer} buffer input
 * @returns {object}
 */
export function detectFormatAndHeaders(buffer) {
  let format;
  const headers = {};

  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    format = "png";
    headers["Content-Type"] = "image/png";
  } else if (
    buffer[0] === 0xff &&
    buffer[1] === 0xd8 &&
    buffer[buffer.length - 2] === 0xff &&
    buffer[buffer.length - 1] === 0xd9
  ) {
    format = "jpeg"; // equivalent jpg
    headers["Content-Type"] = "image/jpeg"; // equivalent image/jpg
  } else if (
    buffer[0] === 0x47 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x38 &&
    (buffer[4] === 0x39 || buffer[4] === 0x37) &&
    buffer[5] === 0x61
  ) {
    format = "gif";
    headers["Content-Type"] = "image/gif";
  } else if (
    buffer[0] === 0x52 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x46 &&
    buffer[8] === 0x57 &&
    buffer[9] === 0x45 &&
    buffer[10] === 0x42 &&
    buffer[11] === 0x50
  ) {
    format = "webp";
    headers["Content-Type"] = "image/webp";
  } else {
    format = "pbf";
    headers["Content-Type"] = "application/x-protobuf";

    if (buffer[0] === 0x78 && buffer[1] === 0x9c) {
      headers["Content-Encoding"] = "deflate";
    } else if (buffer[0] === 0x1f && buffer[1] === 0x8b) {
      headers["Content-Encoding"] = "gzip";
    }
  }

  return {
    format,
    headers,
  };
}

/**
 * Calculate MD5 hash of a buffer
 * @param {Buffer} buffer The buffer data of the file
 * @returns {string} The MD5 hash
 */
export function calculateMD5(buffer) {
  return crypto.createHash("md5").update(buffer).digest("hex");
}

/**
 *
 */
export const gzipAsync = util.promisify(zlib.gzip);

/**
 *
 */
export const unzipAsync = util.promisify(zlib.unzip);

/**
 * Validate tileJSON
 * @param {object} schema JSON schema
 * @param {object} jsonData JSON data
 * @returns
 */
export async function validateJSON(schema, jsonData) {
  try {
    const ajv = new Ajv({
      allErrors: true,
      useDefaults: true,
    });

    const validate = ajv.compile(schema);

    if (!validate(jsonData)) {
      throw validate.errors
        .map((error) => `\n\t${error.instancePath} ${error.message}`)
        .join();
    }
  } catch (error) {
    throw error;
  }
}

/**
 * Deep clone an object using JSON serialization
 * @param {Object} obj The object to clone
 * @returns {Object} The deep-cloned object
 */
export function deepClone(obj) {
  if (obj !== undefined) {
    return JSON.parse(JSON.stringify(obj));
  }
}

/**
 * Update server-info.json file
 * @param {Object<string,string>} serverInfoAdds Server info object
 * @returns {Promise<void>}
 */
export async function updateServerInfoFile(serverInfoAdds) {
  const filePath = `${process.env.DATA_DIR}/server-info.json`;
  const tempFilePath = `${filePath}.tmp`;

  try {
    const serverInfo = JSON.parse(await fsPromise.readFile(filePath, "utf8"));

    await fsPromise.writeFile(
      tempFilePath,
      JSON.stringify(
        {
          ...serverInfo,
          ...serverInfoAdds,
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
        JSON.stringify(serverInfoAdds, null, 2),
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
 * Update server-info.json file with lock
 * @param {Object<string,string>} serverInfoAdds Server info object
 * @param {number} timeout Timeout in milliseconds
 * @returns {Promise<void>}
 */
export async function updateServerInfoFileWithLock(serverInfoAdds, timeout) {
  const filePath = `${process.env.DATA_DIR}/server-info.json`;
  const startTime = Date.now();
  const lockFilePath = `${filePath}.lock`;
  let lockFileHandle;

  while (Date.now() - startTime <= timeout) {
    try {
      lockFileHandle = await fsPromise.open(lockFilePath, "wx");

      await updateServerInfoFile(serverInfoAdds);

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

        await updateServerInfoFileWithLock(serverInfoAdds, timeout);

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
 * Get main PID
 * @returns {Promise<number>}
 */
export async function getMainPID() {
  try {
    const data = await fsPromise.readFile(
      `${process.env.DATA_DIR}/server-info.json`,
      "utf8"
    );

    return JSON.parse(data).mainPID;
  } catch (error) {
    if (error.code === "ENOENT") {
      return;
    }

    throw error;
  }
}

/**
 * Restart server
 * @returns {Promise<void>}
 */
export async function restartServer() {
  const mainPID = await getMainPID();

  if (mainPID !== undefined) {
    process.kill(mainPID, "SIGTERM");
  }
}

/**
 * Kill server
 * @returns {Promise<void>}
 */
export async function killServer() {
  const mainPID = await getMainPID();

  if (mainPID !== undefined) {
    process.kill(mainPID, "SIGINT");
  }
}

/**
 * Start task
 * @returns {Promise<void>}
 */
export async function startTask() {
  const taskPID = await getMainPID();

  if (taskPID !== undefined) {
    process.kill(taskPID, "SIGUSR1");
  }
}

/**
 * Cancel task
 * @returns {Promise<void>}
 */
export async function cancelTask() {
  const taskPID = await getMainPID();

  if (taskPID !== undefined) {
    process.kill(taskPID, "SIGUSR2");
  }
}

/**
 * Get version
 * @returns {string}
 */
export function getVersion() {
  return JSON.parse(fs.readFileSync("package.json", "utf8")).version;
}
