"use strict";

import { validateJSON } from "./utils.js";
import fsPromise from "node:fs/promises";

let config;

/**
 * Read config.json file
 * @param {string} dataDir The data directory
 * @param {boolean} isValidate Is validate file?
 * @returns {Promise<void>}
 */
async function readConfigFile(dataDir, isValidate) {
  /* Read config.json file */
  const data = await fsPromise.readFile(`${dataDir}/config.json`, "utf8");

  config = JSON.parse(data);

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
              killEndpoint: {
                type: "boolean",
              },
              restartEndpoint: {
                type: "boolean",
              },
              configEndpoint: {
                type: "boolean",
              },
              frontPage: {
                type: "boolean",
              },
              serveWMTS: {
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
              createMetadataIndex: {
                type: "boolean",
              },
              createTilesIndex: {
                type: "boolean",
              },
              loggerFormat: {
                type: "string",
                minLength: 1,
              },
              minPoolSize: {
                type: "integer",
                minimum: 1,
              },
              maxPoolSize: {
                type: "integer",
                minimum: 1,
              },
              taskSchedule: {
                type: "string",
                pattern:
                  "^([0-5]?\\d|\\*)\\s([0-5]?\\d|\\*)\\s([0-1]?\\d|2[0-3]|\\*)\\s([1-9]|[12]\\d|3[01]|\\*)\\s([1-9]|1[0-2]|\\*)\\s([0-7]|\\*)$|^([0-5]?\\d|\\*)\\s([0-5]?\\d|\\*)\\s([0-1]?\\d|2[0-3]|\\*)\\s([1-9]|[12]\\d|3[01]|\\*)\\s([1-9]|1[0-2]|\\*)$",
                minLength: 1,
              },
              restartServerAfterTask: {
                type: "boolean",
              },
              killInterval: {
                type: "integer",
                minimum: 0,
              },
              restartInterval: {
                type: "integer",
                minimum: 0,
              },
              process: {
                type: "integer",
                minimum: 1,
              },
            },
            required: [
              "listenPort",
              "killEndpoint",
              "restartEndpoint",
              "configEndpoint",
              "frontPage",
              "serveWMTS",
              "serveRendered",
              "maxScaleRender",
              "renderedCompression",
              "serveSwagger",
              "createMetadataIndex",
              "createTilesIndex",
              "restartServerAfterTask",
              "killInterval",
              "restartInterval",
              "process",
              "loggerFormat",
              "minPoolSize",
              "maxPoolSize",
            ],
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
  config.paths = {
    dir: dataDir,
    config: `${dataDir}/config.json`,
    seed: `${dataDir}/seed.json`,
    cleanUp: `${dataDir}/cleanup.json`,
    fonts: `${dataDir}/fonts`,
    styles: `${dataDir}/styles`,
    sprites: `${dataDir}/sprites`,
    mbtiles: `${dataDir}/mbtiles`,
    pmtiles: `${dataDir}/pmtiles`,
    xyzs: `${dataDir}/xyzs`,
    caches: {
      fonts: `${dataDir}/caches/fonts`,
      styles: `${dataDir}/caches/styles`,
      sprites: `${dataDir}/caches/sprites`,
      mbtiles: `${dataDir}/caches/mbtiles`,
      pmtiles: `${dataDir}/caches/pmtiles`,
      xyzs: `${dataDir}/caches/xyzs`,
    },
  };

  config.repo = Object.fromEntries(
    ["styles", "rendereds", "datas", "fonts", "sprites"].map((type) => [
      type,
      {},
    ])
  );

  config.fallbackFont = "Open Sans Regular";
  config.startupComplete = false;
}

/**
 * Read seed.json file
 * @param {string} dataDir The data directory
 * @param {boolean} isValidate Is validate file?
 * @returns {Promise<object>}
 */
async function readSeedFile(dataDir, isValidate) {
  /* Read seed.json file */
  const data = await fsPromise.readFile(`${dataDir}/seed.json`, "utf8");

  const seed = JSON.parse(data);

  /* Validate seed.json file */
  if (isValidate === true) {
    await validateJSON(
      {
        type: "object",
        properties: {
          styles: {
            type: "object",
            additionalProperties: {
              type: "object",
              properties: {
                url: {
                  type: "string",
                  minLength: 1,
                },
                refreshBefore: {
                  type: "object",
                  properties: {
                    time: {
                      type: "string",
                      minLength: 1,
                    },
                    day: {
                      type: "integer",
                      minimum: 0,
                    },
                    md5: {
                      type: "boolean",
                    },
                  },
                  anyOf: [
                    { required: ["time"] },
                    { required: ["day"] },
                    { required: ["md5"] },
                  ],
                  additionalProperties: true,
                },
              },
              required: ["url"],
              additionalProperties: true,
            },
          },
          datas: {
            type: "object",
            additionalProperties: {
              type: "object",
              properties: {
                metadata: {
                  type: "object",
                  properties: {
                    name: {
                      type: "string",
                    },
                    description: {
                      type: "string",
                    },
                    attribution: {
                      type: "string",
                    },
                    version: {
                      type: "string",
                    },
                    type: {
                      type: "string",
                      enum: ["baselayer", "overlay"],
                    },
                    format: {
                      type: "string",
                      enum: ["gif", "png", "jpg", "jpeg", "webp", "pbf"],
                    },
                    minzoom: {
                      type: "integer",
                      minimum: 0,
                      maximum: 22,
                    },
                    maxzoom: {
                      type: "integer",
                      minimum: 0,
                      maximum: 22,
                    },
                    bounds: {
                      type: "array",
                      items: {
                        type: "number",
                        minimum: -180,
                        maximum: 180,
                      },
                      minItems: 4,
                      maxItems: 4,
                    },
                    center: {
                      type: "array",
                      items: {
                        type: "number",
                        minimum: -180,
                        maximum: 180,
                      },
                      minItems: 3,
                      maxItems: 3,
                    },
                    vector_layers: {
                      type: "array",
                      items: {
                        type: "object",
                        properties: {
                          id: {
                            type: "string",
                          },
                          description: {
                            type: "string",
                          },
                          minzoom: {
                            type: "integer",
                            minimum: 0,
                            maximum: 22,
                          },
                          maxzoom: {
                            type: "integer",
                            minimum: 0,
                            maximum: 22,
                          },
                          fields: {
                            type: "object",
                            additionalProperties: {
                              type: "string",
                            },
                          },
                        },
                        required: ["id"],
                        additionalProperties: true,
                      },
                    },
                    tilestats: {
                      type: "object",
                      properties: {
                        layerCount: {
                          type: "integer",
                        },
                      },
                      additionalProperties: true,
                    },
                  },
                  required: ["format"],
                  additionalProperties: true,
                },
                url: {
                  type: "string",
                  minLength: 1,
                },
                refreshBefore: {
                  type: "object",
                  properties: {
                    time: {
                      type: "string",
                      minLength: 1,
                    },
                    day: {
                      type: "integer",
                      minimum: 0,
                    },
                    md5: {
                      type: "boolean",
                    },
                  },
                  anyOf: [
                    { required: ["time"] },
                    { required: ["day"] },
                    { required: ["md5"] },
                  ],
                  additionalProperties: true,
                },
                zooms: {
                  type: "array",
                  items: {
                    type: "integer",
                    minimum: 0,
                    maximum: 22,
                  },
                  minItems: 0,
                  maxItems: 23,
                },
                bbox: {
                  type: "array",
                  items: {
                    type: "number",
                    minimum: -180,
                    maximum: 180,
                  },
                  minItems: 4,
                  maxItems: 4,
                },
                timeout: {
                  type: "integer",
                  minimum: 0,
                },
                concurrency: {
                  type: "integer",
                  minimum: 1,
                },
                maxTry: {
                  type: "integer",
                  minimum: 1,
                },
              },
              required: ["metadata", "url"],
              additionalProperties: true,
            },
          },
          sprites: {
            type: "object",
            additionalProperties: {
              type: "object",
              properties: {
                url: {
                  type: "string",
                  minLength: 1,
                },
                refreshBefore: {
                  type: "object",
                  properties: {
                    time: {
                      type: "string",
                      minLength: 1,
                    },
                    day: {
                      type: "integer",
                      minimum: 0,
                    },
                    md5: {
                      type: "boolean",
                    },
                  },
                  anyOf: [
                    { required: ["time"] },
                    { required: ["day"] },
                    { required: ["md5"] },
                  ],
                  additionalProperties: true,
                },
              },
              required: ["url"],
              additionalProperties: true,
            },
          },
          fonts: {
            type: "object",
            additionalProperties: {
              type: "object",
              properties: {
                url: {
                  type: "string",
                  minLength: 1,
                },
                refreshBefore: {
                  type: "object",
                  properties: {
                    time: {
                      type: "string",
                      minLength: 1,
                    },
                    day: {
                      type: "integer",
                      minimum: 0,
                    },
                    md5: {
                      type: "boolean",
                    },
                  },
                  anyOf: [
                    { required: ["time"] },
                    { required: ["day"] },
                    { required: ["md5"] },
                  ],
                  additionalProperties: true,
                },
              },
              required: ["url"],
              additionalProperties: true,
            },
          },
        },
        required: ["styles", "datas", "sprites", "fonts"],
        additionalProperties: true,
      },
      seed
    );
  }

  return seed;
}

/**
 * Read cleanup.json file
 * @param {string} dataDir The data directory
 * @param {boolean} isValidate Is validate file?
 * @returns {Promise<object>}
 */
async function readCleanUpFile(dataDir, isValidate) {
  /* Read cleanup.json file */
  const data = await fsPromise.readFile(`${dataDir}/cleanup.json`, "utf8");

  const cleanUp = JSON.parse(data);

  /* Validate cleanup.json file */
  if (isValidate === true) {
    await validateJSON(
      {
        type: "object",
        properties: {
          styles: {
            type: "object",
            additionalProperties: {
              type: "object",
              properties: {
                cleanUpBefore: {
                  type: "object",
                  properties: {
                    time: {
                      type: "string",
                    },
                    day: {
                      type: "integer",
                      minimum: 0,
                    },
                  },
                  anyOf: [{ required: ["time"] }, { required: ["day"] }],
                  additionalProperties: true,
                },
              },
              required: ["url"],
              additionalProperties: true,
            },
          },
          datas: {
            type: "object",
            additionalProperties: {
              type: "object",
              properties: {
                bbox: {
                  type: "array",
                  items: {
                    type: "number",
                    minimum: -180,
                    maximum: 180,
                  },
                  minItems: 4,
                  maxItems: 4,
                },
                zooms: {
                  type: "array",
                  items: {
                    type: "integer",
                    minimum: 0,
                    maximum: 22,
                  },
                  minItems: 0,
                  maxItems: 23,
                },
                cleanUpBefore: {
                  type: "object",
                  properties: {
                    time: {
                      type: "string",
                      minLength: 1,
                    },
                    day: {
                      type: "integer",
                      minimum: 0,
                    },
                  },
                  anyOf: [{ required: ["time"] }, { required: ["day"] }],
                  additionalProperties: true,
                },
              },
              additionalProperties: true,
            },
          },
          sprites: {
            type: "object",
            additionalProperties: {
              type: "object",
              properties: {
                cleanUpBefore: {
                  type: "object",
                  properties: {
                    time: {
                      type: "string",
                      minLength: 1,
                    },
                    day: {
                      type: "integer",
                      minimum: 0,
                    },
                  },
                  anyOf: [{ required: ["time"] }, { required: ["day"] }],
                  additionalProperties: true,
                },
              },
              required: ["url"],
              additionalProperties: true,
            },
          },
          fonts: {
            type: "object",
            additionalProperties: {
              type: "object",
              properties: {
                cleanUpBefore: {
                  type: "object",
                  properties: {
                    time: {
                      type: "string",
                      minLength: 1,
                    },
                    day: {
                      type: "integer",
                      minimum: 0,
                    },
                  },
                  anyOf: [{ required: ["time"] }, { required: ["day"] }],
                  additionalProperties: true,
                },
              },
              required: ["url"],
              additionalProperties: true,
            },
          },
        },
        required: ["styles", "datas", "sprites", "fonts"],
        additionalProperties: true,
      },
      cleanUp
    );
  }

  return cleanUp;
}

export { readConfigFile, readSeedFile, readCleanUpFile, config };
