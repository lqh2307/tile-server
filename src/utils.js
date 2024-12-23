"use strict";

import { StatusCodes } from "http-status-codes";
import fsPromise from "node:fs/promises";
import { printLog } from "./logger.js";
import https from "node:https";
import http from "node:http";
import crypto from "crypto";
import axios from "axios";
import proj4 from "proj4";
import fs from "node:fs";
import zlib from "zlib";
import util from "util";
import Ajv from "ajv";

/**
 * Get data from URL
 * @param {string} url URL to fetch data from
 * @param {number} timeout Timeout in milliseconds
 * @param {"arraybuffer"|"json"|"text"|"stream"|"blob"|"document"|"formdata"} responseType Response type
 * @param {boolean} keepAlive Whether to keep the connection alive
 * @returns {Promise<axios.AxiosResponse>}
 */
export async function getDataFromURL(
  url,
  timeout,
  responseType,
  keepAlive = false
) {
  try {
    return await axios({
      method: "GET",
      url: url,
      timeout: timeout,
      responseType: responseType,
      headers: {
        "User-Agent": "Tile Server",
      },
      validateStatus: (status) => {
        return status === StatusCodes.OK;
      },
      httpAgent: new http.Agent({
        keepAlive: keepAlive,
      }),
      httpsAgent: new https.Agent({
        keepAlive: keepAlive,
      }),
    });
  } catch (error) {
    if (error.response) {
      error.message = `Status code: ${error.response.status} - ${error.response.statusText}`;
      error.statusCode = error.response.status;
    }

    throw error;
  }
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
 * Get tile bounds for specific zoom levels intersecting multiple bounding boxes
 * @param {Array<Array<number>>} bboxs Array of bounding boxes [[west, south, east, north]] in EPSG:4326
 * @param {Array<number>} zooms Array of specific zoom levels
 * @param {"xyz"|"tms"} scheme Tile scheme
 * @returns {{ total: number, tilesSummaries: Array<Object<string,object>> }} Object containing total tiles and an array of tile summaries (one per bbox)
 */
export function getTilesBoundsFromBBoxs(bboxs, zooms, scheme) {
  const tilesSummaries = [];
  let total = 0;

  for (const bbox of bboxs) {
    const tilesSummary = {};

    for (const zoom of zooms) {
      const [xMin, yMin] = getXYZFromLonLatZ(bbox[0], bbox[3], zoom, scheme);
      const [xMax, yMax] = getXYZFromLonLatZ(bbox[2], bbox[1], zoom, scheme);

      tilesSummary[`${zoom}`] = {
        x: [xMin, xMax],
        y: [yMin, yMax],
      };

      total += (xMax - xMin + 1) * (yMax - yMin + 1);
    }

    tilesSummaries.push(tilesSummary);
  }

  return { total, tilesSummaries };
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
 * Get bounding box from center and radius
 * @param {number} lonCenter Longitude of center (EPSG:4326)
 * @param {number} latCenter Latitude of center (EPSG:4326)
 * @param {number} radius Radius in metter (EPSG:3857)
 * @returns {Array<number>} [minLon, minLat, maxLon, maxLat]
 */
function getBBoxFromCircle(lonCenter, latCenter, radius) {
  const [xCenter, yCenter] = proj4("EPSG:4326", "EPSG:3857", [
    lonCenter,
    latCenter,
  ]);

  let [minLon, minLat] = proj4("EPSG:3857", "EPSG:4326", [
    xCenter - radius,
    yCenter - radius,
  ]);
  let [maxLon, maxLat] = proj4("EPSG:3857", "EPSG:4326", [
    xCenter + radius,
    yCenter + radius,
  ]);

  if (minLon > 180) {
    minLon = 180;
  } else if (minLon < -180) {
    minLon = -180;
  }

  if (maxLon > 180) {
    maxLon = 180;
  } else if (maxLon < -180) {
    maxLon = -180;
  }

  if (minLat > 85.051129) {
    minLat = 85.051129;
  } else if (minLat < -85.051129) {
    minLat = -85.051129;
  }

  if (maxLat > 85.051129) {
    maxLat = 85.051129;
  } else if (maxLat < -85.051129) {
    maxLat = -85.051129;
  }

  return [minLon, minLat, maxLon, maxLat];
}

/**
 * Get XYZ tile from bounding box for specific zoom levels intersecting a bounding box
 * @param {Array<number>} bbox [west, south, east, north] in EPSG:4326
 * @param {Array<number>} zooms Array of specific zoom levels
 * @returns {Array<string>} Array values as z/x/y
 */
export function getXYZTileFromBBox(bbox, zooms) {
  const tiles = [];

  for (const zoom of zooms) {
    const [xMin, yMin] = getXYZFromLonLatZ(bbox[0], bbox[3], zoom, scheme);
    const [xMax, yMax] = getXYZFromLonLatZ(bbox[2], bbox[1], zoom, scheme);

    for (let x = xMin; x <= xMax; x++) {
      for (let y = yMin; y <= yMax; y++) {
        tiles.push(`/${zoom}/${x}/${y}`);
      }
    }
  }

  return tiles;
}

/**
 * Delay function to wait for a specified time
 * @param {number} ms Time to wait in milliseconds
 * @returns {Promise<void>}
 */
export async function delay(ms) {
  if (ms >= 0) {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }
}

/**
 * Calculate MD5 hash of a buffer
 * @param {Buffer} buffer The data buffer
 * @returns {string} The MD5 hash
 */
export function calculateMD5(buffer) {
  return crypto.createHash("md5").update(buffer).digest("hex");
}

/**
 * Attempt do function multiple times
 * @param {function} fn The function to attempt
 * @param {number} maxTry Number of retry attempts on failure
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
          `${error}. ${remainingAttempts} try remaining - After ${after} ms...`
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

      if (
        entry.isFile() === true &&
        (regex === undefined || regex.test(entry.name) === true)
      ) {
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
 * @returns {Promise<void>}
 */
export async function removeOldCacheLocks() {
  const fileNames = await findFiles(
    `${process.env.DATA_DIR}/caches`,
    /^.*\.(lock|tmp)$/,
    true
  );

  await Promise.all(
    fileNames.map(
      (fileName) => fsPromise.rm(`${process.env.DATA_DIR}/caches/${fileName}`),
      {
        force: true,
      }
    )
  );
}

/**
 * Check folder is exist?
 * @param {string} dirPath Directory path
 * @returns {Promise<boolean>}
 */
export async function isExistFolder(dirPath) {
  try {
    const stat = await fsPromise.stat(dirPath);

    return stat.isDirectory();
  } catch (error) {
    if (error.code === "ENOENT") {
      return false;
    } else {
      throw error;
    }
  }
}

/**
 * Check file is exist?
 * @param {string} filePath File path
 * @returns {Promise<boolean>}
 */
export async function isExistFile(filePath) {
  try {
    const stat = await fsPromise.stat(filePath);

    return stat.isFile();
  } catch (error) {
    if (error.code === "ENOENT") {
      return false;
    } else {
      throw error;
    }
  }
}

/**
 * Find matching files in a directory
 * @param {string} dirPath The directory path to search
 * @param {RegExp} regex The regex to match files
 * @param {boolean} recurse Whether to search recursively in subdirectories
 * @returns {Promise<string>} Array of filepaths matching the regex
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
 * @param {Request} req Request object
 * @returns {string}
 */
export function getRequestHost(req) {
  return `${req.headers["x-forwarded-proto"] || req.protocol}://${
    req.headers["host"]
  }${req.headers["x-forwarded-prefix"] || ""}`;
}

/**
 * Create new tileJSON
 * @param {object} metadata Metadata object
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
 * @param {Buffer} buffer Input data
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
    headers["content-type"] = "image/png";
  } else if (
    buffer[0] === 0xff &&
    buffer[1] === 0xd8 &&
    buffer[buffer.length - 2] === 0xff &&
    buffer[buffer.length - 1] === 0xd9
  ) {
    format = "jpeg"; // equivalent jpg
    headers["content-type"] = "image/jpeg"; // equivalent image/jpg
  } else if (
    buffer[0] === 0x47 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x38 &&
    (buffer[4] === 0x39 || buffer[4] === 0x37) &&
    buffer[5] === 0x61
  ) {
    format = "gif";
    headers["content-type"] = "image/gif";
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
    headers["content-type"] = "image/webp";
  } else {
    format = "pbf";
    headers["content-type"] = "application/x-protobuf";

    if (buffer[0] === 0x78 && buffer[1] === 0x9c) {
      headers["content-encoding"] = "deflate";
    } else if (buffer[0] === 0x1f && buffer[1] === 0x8b) {
      headers["content-encoding"] = "gzip";
    }
  }

  return {
    format,
    headers,
  };
}

/**
 * Compress data using gzip algorithm asynchronously
 * @param {Buffer|string} input The data to compress
 * @param {zlib.ZlibOptions} options Optional zlib compression options
 * @returns {Promise<Buffer>} A Promise that resolves to the compressed data as a Buffer
 */
export const gzipAsync = util.promisify(zlib.gzip);

/**
 * Decompress gzip-compressed data asynchronously
 * @param {Buffer|string} input The compressed data to decompress
 * @param {zlib.ZlibOptions} options Optional zlib decompression options
 * @returns {Promise<Buffer>} A Promise that resolves to the decompressed data as a Buffer
 */
export const unzipAsync = util.promisify(zlib.unzip);

/**
 * Decompress deflate-compressed data asynchronously
 * @param {Buffer|string} input The compressed data to decompress
 * @param {zlib.ZlibOptions} options Optional zlib decompression options
 * @returns {Promise<Buffer>} A Promise that resolves to the decompressed data as a Buffer
 */
export const inflateAsync = util.promisify(zlib.inflate);

/**
 * Validate tileJSON
 * @param {object} schema JSON schema
 * @param {object} jsonData JSON data
 * @returns
 */
export async function validateJSON(schema, jsonData) {
  try {
    const validate = new Ajv({
      allErrors: true,
      useDefaults: true,
    }).compile(schema);

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
 * Get version of server
 * @returns {string}
 */
export function getVersion() {
  return JSON.parse(fs.readFileSync("package.json", "utf8")).version;
}
