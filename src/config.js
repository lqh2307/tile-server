"use strict";

import { validateJSON } from "./utils.js";
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
    await validateJSON(
      {
        type: "object",
        properties: {
          options: {
            type: "object",
            properties: {
              listenPort: {
                type: "integer",
                minimum: 0,
              },
              serverEndpoint: {
                type: "boolean",
              },
              serveFrontPage: {
                type: "boolean",
              },
              serveSwagger: {
                type: "boolean",
              },
              loggerFormat: {
                type: "string",
                minLength: 1,
              },
              taskSchedule: {
                type: "string",
                pattern:
                  "^([0-5]?\\d|\\*)\\s([0-5]?\\d|\\*)\\s([0-1]?\\d|2[0-3]|\\*)\\s([1-9]|[12]\\d|3[01]|\\*)\\s([1-9]|1[0-2]|\\*)\\s([0-7]|\\*)$|^([0-5]?\\d|\\*)\\s([0-5]?\\d|\\*)\\s([0-1]?\\d|2[0-3]|\\*)\\s([1-9]|[12]\\d|3[01]|\\*)\\s([1-9]|1[0-2]|\\*)$",
                minLength: 1,
              },
              postgreSQLBaseURI: {
                type: "string",
                pattern:
                  "^postgres(?:ql)?://(?:(?:[a-zA-Z0-9._~!$&'()*+,;=%-]+)(?::[a-zA-Z0-9._~!$&'()*+,;=%-]+)?@)?(?:[a-zA-Z0-9.-]+|\\[[a-fA-F0-9:]+\\])(?::\\d+)?(?:/[a-zA-Z0-9._~!$&'()*+,;=%-]*)?(?:\\?[a-zA-Z0-9._~!$&'()*+,;=%-]+=[a-zA-Z0-9._~!$&'()*+,;=%-]+(?:&[a-zA-Z0-9._~!$&'()*+,;=%-]+=[a-zA-Z0-9._~!$&'()*+,;=%-]+)*)?$",
                minLength: 1,
              },
              restartServerAfterTask: {
                type: "boolean",
              },
              process: {
                type: "integer",
                minimum: 1,
              },
              thread: {
                type: "integer",
                minimum: 1,
              },
            },
          },
          styles: {
            type: "object",
            additionalProperties: {
              type: "object",
              properties: {
                style: {
                  type: "string",
                  minLength: 1,
                },
                cache: {
                  type: "object",
                  properties: {
                    forward: {
                      type: "boolean",
                    },
                    store: {
                      type: "boolean",
                    },
                  },
                },
                rendered: {
                  type: "object",
                  properties: {
                    compressionLevel: {
                      type: "integer",
                      minimum: 1,
                      maximum: 9,
                    },
                  },
                },
              },
              required: ["style"],
            },
          },
          geojsons: {
            type: "object",
            additionalProperties: {
              type: "object",
              additionalProperties: {
                type: "object",
                properties: {
                  geojson: {
                    type: "string",
                    minLength: 1,
                  },
                  cache: {
                    type: "object",
                    properties: {
                      forward: {
                        type: "boolean",
                      },
                      store: {
                        type: "boolean",
                      },
                    },
                  },
                },
                required: ["geojson"],
              },
            },
          },
          datas: {
            type: "object",
            additionalProperties: {
              type: "object",
              properties: {
                mbtiles: {
                  type: "string",
                  minLength: 1,
                },
                pmtiles: {
                  type: "string",
                  minLength: 1,
                },
                xyz: {
                  type: "string",
                  minLength: 1,
                },
                pg: {
                  type: "string",
                  minLength: 1,
                },
                cache: {
                  type: "object",
                  properties: {
                    forward: {
                      type: "boolean",
                    },
                    store: {
                      type: "boolean",
                    },
                  },
                },
              },
              anyOf: [
                { required: ["mbtiles"] },
                { required: ["pmtiles"] },
                { required: ["xyz"] },
                { required: ["pg"] },
              ],
            },
          },
          sprites: {
            type: "object",
            additionalProperties: {
              type: "boolean",
            },
          },
          fonts: {
            type: "object",
            additionalProperties: {
              type: "boolean",
            },
          },
        },
        required: [
          "options",
          "styles",
          "geojsons",
          "datas",
          "sprites",
          "fonts",
        ],
        additionalProperties: false,
      },
      config
    );
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
