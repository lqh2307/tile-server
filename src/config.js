"use strict";

import { validateJSON } from "./utils.js";
import fsPromise from "node:fs/promises";

let config;

/**
 * Read config.json file
 * @param {string} dataDir
 * @returns {Promise<void>}
 */
async function readConfigFile(dataDir) {
  const configFilePath = `${dataDir}/config.json`;

  /* Validate config.json file */
  await validateJSON(
    {
      type: "object",
      properties: {
        options: {
          type: "object",
          properties: {
            listenPort: {
              type: "integer",
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
    configFilePath
  );

  /* Read config.json file */
  const data = await fsPromise.readFile(configFilePath, "utf8");

  config = JSON.parse(data);

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
 * @param {string} dataDir
 * @returns {Promise<object>}
 */
async function readSeedFile(dataDir) {
  const seedFilePath = `${dataDir}/seed.json`;

  /* Validate seed.json file */
  await validateJSON(
    {
      type: "object",
      properties: {
        restartServerAfterSeed: {
          type: "boolean",
        },
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
              name: {
                type: "string",
              },
              description: {
                type: "string",
              },
              url: {
                type: "string",
                minLength: 1,
              },
              format: {
                type: "string",
                enum: ["gif", "png", "jpg", "jpeg", "webp", "pbf"],
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
                additionalProperties: {
                  type: "object",
                  properties: {
                    layerCount: {
                      type: "integer",
                    },
                  },
                  additionalProperties: true,
                },
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
            required: ["url"],
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
      required: [
        "restartServerAfterSeed",
        "styles",
        "datas",
        "sprites",
        "fonts",
      ],
      additionalProperties: true,
    },
    seedFilePath
  );

  /* Read seed.json file */
  const data = await fsPromise.readFile(seedFilePath, "utf8");

  return JSON.parse(data);
}

/**
 * Read cleanup.json file
 * @param {string} dataDir
 * @returns {Promise<object>}
 */
async function readCleanUpFile(dataDir) {
  const cleanUpFilePath = `${dataDir}/cleanup.json`;

  /* Validate cleanup.json file */
  await validateJSON(
    {
      type: "object",
      properties: {
        restartServerAfterCleanUp: {
          type: "boolean",
        },
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
      required: [
        "restartServerAfterCleanUp",
        "styles",
        "datas",
        "sprites",
        "fonts",
      ],
      additionalProperties: true,
    },
    cleanUpFilePath
  );

  /* Read cleanup.json file */
  const data = await fsPromise.readFile(cleanUpFilePath, "utf8");

  return JSON.parse(data);
}

export { readConfigFile, readSeedFile, readCleanUpFile, config };
