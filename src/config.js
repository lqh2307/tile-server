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
              configEndpoint: {
                type: "boolean",
              },
              serveFrontPage: {
                type: "boolean",
              },
              serveRendered: {
                type: "boolean",
              },
              maxScaleRender: {
                type: "number",
                minimum: 1,
              },
              renderedCompression: {
                type: "integer",
                minimum: 1,
                maximum: 9,
              },
              serveSwagger: {
                type: "boolean",
              },
              loggerFormat: {
                type: "string",
                minLength: 1,
              },
              minRenderedPoolSize: {
                type: "integer",
                minimum: 1,
              },
              maxRenderedPoolSize: {
                type: "integer",
                minimum: 1,
              },
              taskSchedule: {
                type: "string",
                pattern:
                  "^([0-5]?\\d|\\*)\\s([0-5]?\\d|\\*)\\s([0-1]?\\d|2[0-3]|\\*)\\s([1-9]|[12]\\d|3[01]|\\*)\\s([1-9]|1[0-2]|\\*)\\s([0-7]|\\*)$|^([0-5]?\\d|\\*)\\s([0-5]?\\d|\\*)\\s([0-1]?\\d|2[0-3]|\\*)\\s([1-9]|[12]\\d|3[01]|\\*)\\s([1-9]|1[0-2]|\\*)$",
                minLength: 1,
              },
              mongoDBURI: {
                type: "string",
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
            additionalProperties: true,
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
                  additionalProperties: true,
                },
              },
              required: ["style"],
              additionalProperties: true,
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
                  additionalProperties: true,
                },
              },
              additionalProperties: true,
              anyOf: [
                { required: ["mbtiles"] },
                { required: ["pmtiles"] },
                { required: ["xyz"] },
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
        additionalProperties: true,
      },
      config
    );
  }

  /* Fix object */
  config.options = {
    listenPort: config.options.listenPort ?? 8080,
    serverEndpoint: config.options.serverEndpoint ?? true,
    configEndpoint: config.options.configEndpoint ?? true,
    serveFrontPage: config.options.serveFrontPage ?? true,
    serveSwagger: config.options.serveSwagger ?? true,
    serveRendered: config.options.serveRendered ?? true,
    maxScaleRender: config.options.maxScaleRender ?? 1,
    renderedCompression: config.options.renderedCompression ?? 1,
    minRenderedPoolSize: config.options.minRenderedPoolSize ?? os.cpus().length,
    maxRenderedPoolSize:
      config.options.maxRenderedPoolSize ?? os.cpus().length * 2,
    loggerFormat:
      config.options.loggerFormat ??
      ":date[iso] [INFO] :method :url :status :res[content-length] :response-time :remote-addr :user-agent",
    taskSchedule: config.options.taskSchedule, // undefined
    mongoDBURI: config.options.mongoDBURI, // undefined
    restartServerAfterTask: config.options.restartServerAfterTask ?? true,
    process: config.options.process ?? 1,
    thread: config.options.thread ?? os.cpus().length,
    fallbackFont: "Open Sans Regular",
  };

  config.repo = Object.fromEntries(
    ["styles", "rendereds", "datas", "fonts", "sprites"].map((type) => [
      type,
      {},
    ])
  );

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
