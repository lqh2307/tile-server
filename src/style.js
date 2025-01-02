"use strict";

import { delay, getDataFromURL, isLocalTileURL, retry } from "./utils.js";
import { validateStyleMin } from "@maplibre/maplibre-gl-style-spec";
import { StatusCodes } from "http-status-codes";
import fsPromise from "node:fs/promises";
import { printLog } from "./logger.js";
import { config } from "./config.js";
import path from "node:path";

/**
 * Create style data file
 * @param {string} filePath File path to store style file
 * @param {Buffer} data Data buffer
 * @returns {Promise<void>}
 */
async function createStyleDataFile(filePath, data) {
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
 * Create style data file with lock
 * @param {string} filePath File path to store style file
 * @param {Buffer} data Data buffer
 * @param {number} timeout Timeout in milliseconds
 * @returns {Promise<void>}
 */
async function createStyleDataFileWithLock(filePath, data, timeout) {
  const startTime = Date.now();

  const lockFilePath = `${filePath}.lock`;
  let lockFileHandle;

  while (Date.now() - startTime <= timeout) {
    try {
      lockFileHandle = await fsPromise.open(lockFilePath, "wx");

      await createStyleDataFile(filePath, data);

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

        lockFileHandle = await fsPromise.open(lockFilePath, "wx");

        await createStyleDataFile(filePath, data);

        await lockFileHandle.close();

        await fsPromise.rm(lockFilePath, {
          force: true,
        });

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
 * Remove style data file with lock
 * @param {string} filePath File path to remove style data file
 * @param {number} timeout Timeout in milliseconds
 * @returns {Promise<void>}
 */
export async function removeStyleDataFileWithLock(filePath, timeout) {
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
 * Download style file
 * @param {string} url The URL to download the file from
 * @param {string} filePath File path
 * @param {number} maxTry Number of retry attempts on failure
 * @param {number} timeout Timeout in milliseconds
 * @returns {Promise<void>}
 */
export async function downloadStyleFile(url, filePath, maxTry, timeout) {
  await retry(async () => {
    try {
      // Get data from URL
      const response = await getDataFromURL(url, timeout, "arraybuffer");

      // Store data to file
      await cacheStyleFile(filePath, response.data);
    } catch (error) {
      if (error.statusCode !== undefined) {
        printLog(
          "error",
          `Failed to download style file "${filePath}" from "${url}": ${error}`
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
 * Remove style file
 * @param {string} filePath File path
 * @param {number} maxTry Number of retry attempts on failure
 * @param {number} timeout Timeout in milliseconds
 * @returns {Promise<void>}
 */
export async function removeStyleFile(filePath, maxTry, timeout) {
  await retry(async () => {
    await removeStyleDataFileWithLock(filePath, timeout);
  }, maxTry);
}

/**
 * Cache style file
 * @param {string} filePath File path
 * @param {Buffer} data Tile data buffer
 * @returns {Promise<void>}
 */
export async function cacheStyleFile(filePath, data) {
  await createStyleDataFileWithLock(
    filePath,
    data,
    300000 // 5 mins
  );
}

/**
 * Get styleJSON from a URL
 * @param {string} url The URL to fetch data from
 * @param {number} timeout Timeout in milliseconds
 * @returns {Promise<object>}
 */
export async function getStyleJSONFromURL(url, timeout) {
  try {
    const response = await getDataFromURL(url, timeout, "json");

    return response.data;
  } catch (error) {
    if (error.statusCode !== undefined) {
      if (
        error.statusCode === StatusCodes.NO_CONTENT ||
        error.statusCode === StatusCodes.NOT_FOUND
      ) {
        throw new Error("Style does not exist");
      } else {
        throw new Error(`Failed to get style from "${url}": ${error}`);
      }
    } else {
      throw new Error(`Failed to get style from "${url}": ${error}`);
    }
  }
}

/**
 * Validate style
 * @param {object} styleJSON StyleJSON
 * @returns {Promise<void>}
 */
export async function validateStyle(styleJSON) {
  /* Validate style */
  const validationErrors = validateStyleMin(styleJSON);
  if (validationErrors.length > 0) {
    throw new Error(
      validationErrors
        .map((validationError) => `\n\t${validationError.message}`)
        .join()
    );
  }

  /* Validate fonts */
  if (styleJSON.glyphs !== undefined) {
    if (
      styleJSON.glyphs.startsWith("fonts://") === false &&
      styleJSON.glyphs.startsWith("https://") === false &&
      styleJSON.glyphs.startsWith("http://") === false
    ) {
      throw new Error("Invalid fonts url");
    }
  }

  /* Validate sprite */
  if (styleJSON.sprite !== undefined) {
    if (styleJSON.sprite.startsWith("sprites://") === true) {
      const spriteID = styleJSON.sprite.slice(
        10,
        styleJSON.sprite.lastIndexOf("/")
      );

      if (config.repo.sprites[spriteID] === undefined) {
        throw new Error(`Sprite "${spriteID}" is not found`);
      }
    } else if (
      styleJSON.sprite.startsWith("https://") === false &&
      styleJSON.sprite.startsWith("http://") === false
    ) {
      throw new Error("Invalid sprite url");
    }
  }

  /* Validate sources */
  await Promise.all(
    Object.keys(styleJSON.sources).map(async (id) => {
      const source = styleJSON.sources[id];

      if (source.url !== undefined) {
        if (isLocalTileURL(source.url) === true) {
          const sourceID = source.url.split("/")[2];

          if (config.repo.datas[sourceID] === undefined) {
            throw new Error(
              `Source "${id}" is not found data source "${sourceID}"`
            );
          }
        } else if (
          source.url.startsWith("https://") === false &&
          source.url.startsWith("http://") === false
        ) {
          throw new Error(`Source "${id}" is invalid data url "${url}"`);
        }
      }

      if (source.urls !== undefined) {
        if (source.urls.length === 0) {
          throw new Error(`Source "${id}" is invalid data urls`);
        }

        source.urls.forEach((url) => {
          if (isLocalTileURL(url) === true) {
            const sourceID = url.split("/")[2];

            if (config.repo.datas[sourceID] === undefined) {
              throw new Error(
                `Source "${id}" is not found data source "${sourceID}"`
              );
            }
          } else if (
            url.startsWith("https://") === false &&
            url.startsWith("http://") === false
          ) {
            throw new Error(`Source "${id}" is invalid data url "${url}"`);
          }
        });
      }

      if (source.tiles !== undefined) {
        if (source.tiles.length === 0) {
          throw new Error(`Source "${id}" is invalid tile urls`);
        }

        source.tiles.forEach((tile) => {
          if (isLocalTileURL(tile) === true) {
            const sourceID = tile.split("/")[2];

            if (config.repo.datas[sourceID] === undefined) {
              throw new Error(
                `Source "${id}" is not found data source "${sourceID}"`
              );
            }
          } else if (
            tile.startsWith("https://") === false &&
            tile.startsWith("http://") === false
          ) {
            throw new Error(`Source "${id}" is invalid tile url "${url}"`);
          }
        });
      }
    })
  );
}

/**
 * Get style
 * @param {string} filePath
 * @returns {Promise<object>}
 */
export async function getStyle(filePath) {
  try {
    const data = await fsPromise.readFile(filePath);
    if (!data) {
      throw new Error("Style does not exist");
    }

    return JSON.parse(data);
  } catch (error) {
    if (error.code === "ENOENT") {
      throw new Error("Style does not exist");
    } else {
      throw error;
    }
  }
}

/**
 * Get created of style
 * @param {string} filePath The path of the file
 * @returns {Promise<number>}
 */
export async function getStyleCreated(filePath) {
  try {
    const stats = await fsPromise.stat(filePath);

    return stats.ctimeMs;
  } catch (error) {
    if (error.code === "ENOENT") {
      throw new Error("Style created does not exist");
    } else {
      throw error;
    }
  }
}
