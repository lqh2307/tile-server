"use strict";

import { validateJSON } from "./utils.js";
import fsPromise from "node:fs/promises";
import os from "os";

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
                    maxScale: {
                      type: "number",
                      minimum: 1,
                    },
                    compressionLevel: {
                      type: "integer",
                      minimum: 1,
                      maximum: 9,
                    },
                    minPoolSize: {
                      type: "integer",
                      minimum: 1,
                    },
                    maxPoolSize: {
                      type: "integer",
                      minimum: 1,
                    },
                  },
                },
              },
              required: ["style"],
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
        required: ["options", "styles", "datas", "sprites", "fonts"],
        additionalProperties: false,
      },
      config
    );
  }

  /* Fix object */
  config.options = {
    listenPort: config.options.listenPort ?? 8080, // default: 8080
    serverEndpoint: config.options.serverEndpoint ?? true, // default: true
    serveFrontPage: config.options.serveFrontPage ?? true, // default: true
    serveSwagger: config.options.serveSwagger ?? true, // default: true
    loggerFormat:
      config.options.loggerFormat ??
      ":date[iso] [INFO] :method :url :status :res[content-length] :response-time :remote-addr :user-agent", // default: :date[iso] [INFO] :method :url :status :res[content-length] :response-time :remote-addr :user-agent
    taskSchedule: config.options.taskSchedule, // default: undefined
    postgreSQLBaseURI: config.options.postgreSQLBaseURI, // default: undefined
    restartServerAfterTask: config.options.restartServerAfterTask ?? true, // default: true
    process: config.options.process ?? 1, // default: 1
    thread: config.options.thread ?? os.cpus().length, // default: number of cpu
  };

  config.repo = {
    styles: {},
    datas: {},
    fonts: {},
    sprites: {},
  };

  return config;
}

/**
 * Load config.json file
 * @returns {Promise<void>}
 */
async function loadConfigFile() {
  config = await readConfigFile(false);
}

export { readConfigFile, loadConfigFile, config };
