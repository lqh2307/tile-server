"use strict";

import { delay, getDataFromURL, retry } from "./utils.js";
import { StatusCodes } from "http-status-codes";
import fsPromise from "node:fs/promises";
import { printLog } from "./logger.js";
import path from "node:path";

/**
 * Create GeoJSON data file with lock
 * @param {string} filePath File path to store GeoJSON file
 * @param {Buffer} data Data buffer
 * @param {number} timeout Timeout in milliseconds
 * @returns {Promise<void>}
 */
async function createGeoJSONFile(filePath, data, timeout) {
  const startTime = Date.now();

  const lockFilePath = `${filePath}.lock`;
  let lockFileHandle;

  while (Date.now() - startTime <= timeout) {
    try {
      lockFileHandle = await fsPromise.open(lockFilePath, "wx");

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
 * Remove GeoJSON data file with lock
 * @param {string} filePath File path to remove GeoJSON data file
 * @param {number} timeout Timeout in milliseconds
 * @returns {Promise<void>}
 */
export async function removeGeoJSONFile(filePath, timeout) {
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
 * Download GeoJSON file
 * @param {string} url The URL to download the file from
 * @param {string} filePath File path
 * @param {number} maxTry Number of retry attempts on failure
 * @param {number} timeout Timeout in milliseconds
 * @returns {Promise<void>}
 */
export async function downloadGeoJSONFile(url, filePath, maxTry, timeout) {
  await retry(async () => {
    try {
      // Get data from URL
      const response = await getDataFromURL(url, timeout, "arraybuffer");

      // Store data to file
      await cacheGeoJSONFile(filePath, response.data);
    } catch (error) {
      if (error.statusCode !== undefined) {
        printLog(
          "error",
          `Failed to download GeoJSON file "${filePath}" from "${url}": ${error}`
        );

        if (
          error.statusCode === StatusCodes.NO_CONTENT ||
          error.statusCode === StatusCodes.NOT_FOUND
        ) {
          return;
        } else {
          throw error;
        }
      } else {
        throw error;
      }
    }
  }, maxTry);
}

/**
 * Cache GeoJSON file
 * @param {string} filePath File path
 * @param {Buffer} data Tile data buffer
 * @returns {Promise<void>}
 */
export async function cacheGeoJSONFile(filePath, data) {
  await createGeoJSONFile(
    filePath,
    data,
    300000 // 5 mins
  );
}

/**
 * Get GeoJSON from a URL
 * @param {string} url The URL to fetch data from
 * @param {number} timeout Timeout in milliseconds
 * @returns {Promise<object>}
 */
export async function getGeoJSONFromURL(url, timeout) {
  try {
    const response = await getDataFromURL(url, timeout, "json");

    return response.data;
  } catch (error) {
    if (error.statusCode !== undefined) {
      if (
        error.statusCode === StatusCodes.NO_CONTENT ||
        error.statusCode === StatusCodes.NOT_FOUND
      ) {
        throw new Error("GeoJSON does not exist");
      } else {
        throw new Error(`Failed to get GeoJSON from "${url}": ${error}`);
      }
    } else {
      throw new Error(`Failed to get GeoJSON from "${url}": ${error}`);
    }
  }
}

/**
 * Get GeoJSON
 * @param {string} filePath
 * @returns {Promise<object>}
 */
export async function getGeoJSON(filePath) {
  try {
    const data = await fsPromise.readFile(filePath);
    if (!data) {
      throw new Error("GeoJSON does not exist");
    }

    return JSON.parse(data);
  } catch (error) {
    if (error.code === "ENOENT") {
      throw new Error("GeoJSON does not exist");
    } else {
      throw error;
    }
  }
}

/**
 * Get created of GeoJSON
 * @param {string} filePath The path of the file
 * @returns {Promise<number>}
 */
export async function getGeoJSONCreated(filePath) {
  try {
    const stats = await fsPromise.stat(filePath);

    return stats.ctimeMs;
  } catch (error) {
    if (error.code === "ENOENT") {
      throw new Error("GeoJSON created does not exist");
    } else {
      throw error;
    }
  }
}

/**
 * Validate GeoJSON and get geometry types
 * @param {object} geoJSON GeoJSON
 * @returns {Array<string>} List of geometry types
 */
export function validateAndGetGeometryTypes(geoJSON) {
  if (!geoJSON.type) {
    throw new Error("Invalid GeoJSON file");
  }

  const geometryTypes = [];

  function addGeometryType(type) {
    switch (type) {
      case "Polygon":
      case "MultiPolygon": {
        if (geometryTypes.includes("polygon") === false) {
          geometryTypes.push("polygon");
        }

        break;
      }

      case "LineString":
      case "MultiLineString": {
        if (geometryTypes.includes("line") === false) {
          geometryTypes.push("line");
        }

        break;
      }

      case "Point":
      case "MultiPoint": {
        if (geometryTypes.includes("circle") === false) {
          geometryTypes.push("circle");
        }

        break;
      }

      default: {
        throw new Error("Invalid GeoJSON file");
      }
    }
  }

  switch (geoJSON.type) {
    case "FeatureCollection": {
      if (Array.isArray(geoJSON.features) === false) {
        throw new Error("Invalid GeoJSON file");
      }

      geoJSON.features.forEach((feature) => {
        if (feature.geometry.type === "GeometryCollection") {
          if (Array.isArray(feature.geometry.geometries) === false) {
            throw new Error("Invalid GeoJSON file");
          }

          feature.geometry.geometries.forEach((geometry) =>
            addGeometryType(geometry.type)
          );
        } else {
          addGeometryType(feature.geometry.type);
        }
      });

      break;
    }

    case "Feature": {
      if (!geoJSON.geometry) {
        throw new Error("Invalid GeoJSON file");
      }

      if (geoJSON.geometry.type === "GeometryCollection") {
        if (Array.isArray(geoJSON.geometry.geometries) === false) {
          throw new Error("Invalid GeoJSON file");
        }

        geoJSON.geometry.geometries.forEach((geometry) =>
          addGeometryType(geometry.type)
        );
      } else {
        addGeometryType(geoJSON.geometry.type);
      }

      break;
    }

    case "GeometryCollection": {
      if (Array.isArray(geoJSON.geometries) === false) {
        throw new Error("Invalid GeoJSON file");
      }

      geoJSON.geometries.forEach((geometry) => addGeometryType(geometry.type));

      break;
    }

    case "Polygon":
    case "MultiPolygon":
    case "LineString":
    case "MultiLineString":
    case "Point":
    case "MultiPoint": {
      if (!geoJSON.coordinates) {
        throw new Error("Invalid GeoJSON file");
      }

      addGeometryType(geoJSON.type);

      break;
    }

    default: {
      throw new Error("Invalid GeoJSON file");
    }
  }

  return geometryTypes;
}
