"use strict";

import { validateJSON, delay, getJSONSchema } from "./utils.js";
import fsPromise from "node:fs/promises";

let config;

/**
 * Read config.json file
 * @param {boolean} isValidate Is validate file?
 * @returns {Promise<object>}
 */
async function readConfigFile(isValidate) {
  /* Read config.json file */
  const data = await fsPromise.readFile(
    `${process.env.DATA_DIR}/config.json`,
    "utf8"
  );

  const config = JSON.parse(data);

  /* Validate config.json file */
  if (isValidate === true) {
    validateJSON(await getJSONSchema("config"), config);
  }

  return config;
}

/**
 * Load config.json file
 * @returns {Promise<void>}
 */
async function loadConfigFile() {
  config = await readConfigFile(false);

  config.repo = {
    styles: {},
    geojsons: {},
    datas: {},
    fonts: {},
    sprites: {},
  };
}

/**
 * Update config.json file with lock
 * @param {Object<any>} config Config object
 * @param {number} timeout Timeout in milliseconds
 * @returns {Promise<void>}
 */
async function updateConfigFile(config, timeout) {
  const startTime = Date.now();

  const filePath = `${process.env.DATA_DIR}/config.json`;
  const lockFilePath = `${filePath}.lock`;
  let lockFileHandle;

  while (Date.now() - startTime <= timeout) {
    try {
      lockFileHandle = await fsPromise.open(lockFilePath, "wx");

      const tempFilePath = `${filePath}.tmp`;

      try {
        await fsPromise.writeFile(
          tempFilePath,
          JSON.stringify(config, null, 2),
          "utf8"
        );

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
      if (error.code === "EEXIST") {
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

export { updateConfigFile, readConfigFile, loadConfigFile, config };
