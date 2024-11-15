"use strict";

import { validateStyleMin } from "@maplibre/maplibre-gl-style-spec";
import { StatusCodes } from "http-status-codes";
import { delay, retry } from "./utils.js";
import fsPromise from "node:fs/promises";
import { printLog } from "./logger.js";
import { config } from "./config.js";
import https from "node:https";
import path from "node:path";
import http from "node:http";
import axios from "axios";

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
 * @returns {Promise<boolean>}
 */
export async function createStyleDataFileWithLock(filePath, data) {
  const lockFilePath = `${filePath}.lock`;
  let lockFileHandle;

  try {
    lockFileHandle = await fsPromise.open(lockFilePath, "wx");

    await createStyleDataFile(filePath, data);

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

      return await createStyleDataFileWithLock(filePath, data);
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
 * Store style data file with lock
 * @param {string} filePath File path to store style file
 * @param {Buffer} data Data buffer
 * @param {number} timeout Timeout in milliseconds
 * @returns {Promise<void>}
 */
export async function storeStyleDataFileWithLock(filePath, data, timeout) {
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

        return await storeStyleDataFileWithLock(filePath, data, timeout);
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

  throw new Error(`Timeout to access ${lockFilePath} file`);
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
  printLog("info", `Downloading style file "${filePath}" from "${url}"...`);

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
        await storeStyleDataFileWithLock(
          filePath,
          response.data,
          300000 // 5 mins
        );
      } catch (error) {
        if (error.response) {
          if (
            error.response.status === StatusCodes.NO_CONTENT ||
            error.response.status === StatusCodes.NOT_FOUND
          ) {
            printLog(
              "error",
              `Failed to download style file "${filePath}" from "${url}": Status code: ${error.response.status} - ${error.response.statusText}`
            );

            return;
          } else {
            throw new Error(
              `Failed to download style file "${filePath}" from "${url}": Status code: ${error.response.status} - ${error.response.statusText}`
            );
          }
        }

        throw new Error(
          `Failed to download style file "${filePath}" from "${url}": ${error}`
        );
      }
    }, maxTry);
  } catch (error) {
    printLog("error", `${error}`);
  }
}

/**
 * Remove style file
 * @param {string} filePath File path
 * @param {number} maxTry Number of retry attempts on failure
 * @param {number} timeout Timeout in milliseconds
 * @returns {Promise<void>}
 */
export async function removeStyleFile(filePath, maxTry, timeout) {
  printLog("info", `Removing style file "${filePath}"...`);

  try {
    try {
      await retry(async () => {
        await removeStyleDataFileWithLock(filePath, timeout);

        delete hashs[tileName];
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
 * Cache style file
 * @param {string} filePath File path
 * @param {Buffer} data Tile data buffer
 * @returns {Promise<void>}
 */
export async function cacheStyleFile(filePath, data) {
  try {
    if ((await createStyleDataFileWithLock(filePath, data)) === true) {
    }
  } catch (error) {
    throw error;
  }
}

/**
 * Validate style
 * @param {object} styleJSON Style JSON
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
        if (
          source.url.startsWith("pmtiles://") === true ||
          source.url.startsWith("mbtiles://") === true ||
          source.url.startsWith("xyz://") === true
        ) {
          const queryIndex = source.url.lastIndexOf("?");
          const sourceID =
            queryIndex === -1
              ? source.url.split("/")[2]
              : source.url.split("/")[2].slice(0, queryIndex);

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
          if (
            url.startsWith("pmtiles://") === true ||
            url.startsWith("mbtiles://") === true ||
            url.startsWith("xyz://") === true
          ) {
            const queryIndex = url.lastIndexOf("?");
            const sourceID =
              queryIndex === -1
                ? url.split("/")[2]
                : url.split("/")[2].slice(0, queryIndex);

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
          if (
            tile.startsWith("pmtiles://") === true ||
            tile.startsWith("mbtiles://") === true ||
            tile.startsWith("xyz://") === true
          ) {
            const queryIndex = tile.lastIndexOf("?");
            const sourceID =
              queryIndex === -1
                ? tile.split("/")[2]
                : tile.split("/")[2].slice(0, queryIndex);

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
