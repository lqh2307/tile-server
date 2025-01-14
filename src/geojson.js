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
 * @param {boolean} isParse
 * @returns {Promise<object|Buffer>}
 */
export async function getGeoJSONFromURL(url, timeout, isParse) {
  try {
    const response = await getDataFromURL(
      url,
      timeout,
      isParse === true ? "json" : "arraybuffer"
    );

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
 * @param {boolean} isParse
 * @returns {Promise<object|Buffer>}
 */
export async function getGeoJSON(filePath, isParse) {
  try {
    const data = await fsPromise.readFile(filePath);
    if (!data) {
      throw new Error("GeoJSON does not exist");
    }

    if (isParse === true) {
      return JSON.parse(data);
    } else {
      return data;
    }
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
  const geometryTypes = [];

  function addGeometryType(geometryType) {
    switch (geometryType) {
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
        throw new Error(`"type" property is invalid`);
      }
    }
  }

  switch (geoJSON.type) {
    case "FeatureCollection": {
      if (Array.isArray(geoJSON.features) === false) {
        throw new Error(`"features" property is invalid`);
      }

      for (const feature of geoJSON.features) {
        if (feature.type !== "Feature") {
          throw new Error(`"type" property is invalid`);
        }

        if (feature.geometry === null) {
          break;
        }

        if (feature.geometry.type === "GeometryCollection") {
          if (Array.isArray(feature.geometry.geometries) === false) {
            throw new Error(`"geometries" property is invalid`);
          }

          for (const geometry of feature.geometry.geometries) {
            if (
              [
                "Polygon",
                "MultiPolygon",
                "LineString",
                "MultiLineString",
                "Point",
                "MultiPoint",
              ].includes(geometry.type) === false
            ) {
              throw new Error(`"type" property is invalid`);
            }

            if (
              geometry.coordinates !== null &&
              Array.isArray(geometry.coordinates) === false
            ) {
              throw new Error(`"coordinates" property is invalid`);
            }

            addGeometryType(geometry.type);
          }
        } else if (
          [
            "Polygon",
            "MultiPolygon",
            "LineString",
            "MultiLineString",
            "Point",
            "MultiPoint",
          ].includes(feature.geometry.type) === true
        ) {
          if (
            feature.geometry.coordinates !== null &&
            Array.isArray(feature.geometry.coordinates) === false
          ) {
            throw new Error(`"coordinates" property is invalid`);
          }

          addGeometryType(feature.geometry.type);
        } else {
          throw new Error(`"type" property is invalid`);
        }
      }

      break;
    }

    case "Feature": {
      if (geoJSON.geometry === null) {
        break;
      }

      if (geoJSON.geometry.type === "GeometryCollection") {
        if (Array.isArray(geoJSON.geometry.geometries) === false) {
          throw new Error(`"geometries" property is invalid`);
        }

        for (const geometry of geoJSON.geometry.geometries) {
          if (
            [
              "Polygon",
              "MultiPolygon",
              "LineString",
              "MultiLineString",
              "Point",
              "MultiPoint",
            ].includes(geometry.type) === false
          ) {
            throw new Error(`"type" property is invalid`);
          }

          if (
            geometry.coordinates !== null &&
            Array.isArray(geometry.coordinates) === false
          ) {
            throw new Error(`"coordinates" property is invalid`);
          }

          addGeometryType(geometry.type);
        }
      } else if (
        [
          "Polygon",
          "MultiPolygon",
          "LineString",
          "MultiLineString",
          "Point",
          "MultiPoint",
        ].includes(geometry.type) === true
      ) {
        if (
          geometry.coordinates !== null &&
          Array.isArray(geometry.coordinates) === false
        ) {
          throw new Error(`"coordinates" property is invalid`);
        }

        addGeometryType(geometry.type);
      } else {
        throw new Error(`"type" property is invalid`);
      }

      break;
    }

    case "GeometryCollection": {
      if (Array.isArray(geoJSON.geometries) === false) {
        throw new Error(`"geometries" property is invalid`);
      }

      for (const geometry of geoJSON.geometries) {
        if (
          [
            "Polygon",
            "MultiPolygon",
            "LineString",
            "MultiLineString",
            "Point",
            "MultiPoint",
          ].includes(geometry.type) === false
        ) {
          throw new Error(`"type" property is invalid`);
        }

        if (
          geometry.coordinates !== null &&
          Array.isArray(geometry.coordinates) === false
        ) {
          throw new Error(`"coordinates" property is invalid`);
        }

        addGeometryType(geometry.type);
      }

      break;
    }

    case "Polygon":
    case "MultiPolygon":
    case "LineString":
    case "MultiLineString":
    case "Point":
    case "MultiPoint": {
      if (
        geoJSON.coordinates !== null &&
        Array.isArray(geoJSON.coordinates) === false
      ) {
        throw new Error(`"coordinates" property is invalid`);
      }

      addGeometryType(geoJSON.type);

      break;
    }

    default: {
      throw new Error(`"type" property is invalid`);
    }
  }

  return geometryTypes;
}
