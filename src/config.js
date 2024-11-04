"use strict";

import { validateJSON } from "./utils.js";
import fsPromise from "node:fs/promises";

let config;
let seed;
let cleanUp;

/**
 * Load config.json file
 * @param {string} dataDir
 * @returns {Promise<void>}
 */
async function loadConfigFile(dataDir) {
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
          additionalProperties: false,
        },
        styles: {
          type: "object",
          patternProperties: {
            "^(?![.-_])(?!.*[.-_]$)[a-zA-Z0-9-_]+(.[a-zA-Z0-9]+)?$": {
              type: "object",
              properties: {
                style: {
                  type: "string",
                },
              },
              required: ["style"],
              additionalProperties: true,
            },
          },
          additionalProperties: false,
        },
        datas: {
          type: "object",
          patternProperties: {
            "^(?![.-_])(?!.*[.-_]$)[a-zA-Z0-9-_]+(.[a-zA-Z0-9]+)?$": {
              type: "object",
              properties: {
                mbtiles: {
                  type: "string",
                },
                pmtiles: {
                  type: "string",
                },
                xyz: {
                  type: "string",
                },
                cache: {
                  type: "boolean",
                },
              },
              additionalProperties: true,
              anyOf: [
                {
                  required: ["mbtiles"],
                },
                {
                  required: ["pmtiles"],
                },
                {
                  required: ["xyz"],
                },
              ],
            },
          },
          additionalProperties: true,
        },
        sprites: {
          type: "object",
          patternProperties: {
            "^(?![.-_])(?!.*[.-_]$)[a-zA-Z0-9-_]+(.[a-zA-Z0-9]+)?$": {
              type: "boolean",
            },
          },
          additionalProperties: true,
        },
        fonts: {
          type: "object",
          patternProperties: {
            "^(?![.-_])(?!.*[.-_]$)[a-zA-Z0-9-_]+(.[a-zA-Z0-9]+)?$": {
              type: "boolean",
            },
          },
          additionalProperties: true,
        },
      },
      required: ["options", "styles", "datas", "sprites", "fonts"],
      additionalProperties: false,
    },
    `${dataDir}/config.json`
  );

  /* Read config.json file */
  config = JSON.parse(await fsPromise.readFile(configFilePath, "utf8"));

  /* Fix object */
  config.paths = {
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

  config.configFilePath = `${dataDir}/config.json`;
  config.seedFilePath = `${dataDir}/seed.json`;
  config.cleanUpFilePath = `${dataDir}/cleanup.json`;
  config.fallbackFont = "Open Sans Regular";
  config.startupComplete = false;
}

/**
 * Load seed.json file
 * @param {string} dataDir
 * @returns {Promise<void>}
 */
async function loadSeedFile(dataDir) {
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
          patternProperties: {
            "^(?![.-_])(?!.*[.-_]$)[a-zA-Z0-9-_]+(.[a-zA-Z0-9]+)?$": {
              type: "object",
              properties: {
                url: {
                  type: "string",
                },
                refreshBefore: {
                  type: "object",
                  properties: {
                    time: {
                      type: "string",
                    },
                  },
                  anyOf: [
                    {
                      required: ["time"],
                    },
                  ],
                  additionalProperties: true,
                },
              },
              required: ["url", "refreshBefore"],
              additionalProperties: true,
            },
          },
          additionalProperties: true,
        },
        datas: {
          type: "object",
          patternProperties: {
            "^(?![.-_])(?!.*[.-_]$)[a-zA-Z0-9-_]+(.[a-zA-Z0-9]+)?$": {
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
                },
                format: {
                  type: "string",
                  enum: ["gif", "png", "jpg", "jpeg", "webp", "pbf"],
                },
                bounds: {
                  type: "array",
                  items: {
                    type: "number",
                  },
                  minItems: 4,
                  maxItems: 4,
                },
                center: {
                  type: "array",
                  items: {
                    type: "number",
                  },
                  minItems: 3,
                  maxItems: 3,
                },
                zooms: {
                  type: "array",
                  items: {
                    type: "integer",
                  },
                  maxItems: 23,
                },
                scheme: {
                  type: "string",
                  enum: ["xyz", "tms"],
                },
                refreshBefore: {
                  type: "object",
                  properties: {
                    time: {
                      type: "string",
                    },
                  },
                  anyOf: [
                    {
                      required: ["time"],
                    },
                  ],
                  additionalProperties: true,
                },
                timeout: {
                  type: "integer",
                },
                concurrency: {
                  type: "integer",
                },
                maxTry: {
                  type: "integer",
                },
              },
              required: [
                "name",
                "description",
                "url",
                "format",
                "bounds",
                "center",
                "zooms",
                "scheme",
                "type",
                "refreshBefore",
                "timeout",
                "concurrency",
                "maxTry",
              ],
              additionalProperties: true,
            },
          },
          additionalProperties: true,
        },
        sprites: {
          type: "object",
          patternProperties: {
            "^(?![.-_])(?!.*[.-_]$)[a-zA-Z0-9-_]+(.[a-zA-Z0-9]+)?$": {
              type: "object",
              properties: {
                url: {
                  type: "string",
                },
                refreshBefore: {
                  type: "object",
                  properties: {
                    time: {
                      type: "string",
                    },
                  },
                  anyOf: [
                    {
                      required: ["time"],
                    },
                  ],
                  additionalProperties: true,
                },
              },
              required: ["url", "refreshBefore"],
              additionalProperties: true,
            },
          },
          additionalProperties: true,
        },
        fonts: {
          type: "object",
          patternProperties: {
            "^(?![.-_])(?!.*[.-_]$)[a-zA-Z0-9-_]+(.[a-zA-Z0-9]+)?$": {
              type: "object",
              properties: {
                url: {
                  type: "string",
                },
                refreshBefore: {
                  type: "object",
                  properties: {
                    time: {
                      type: "string",
                    },
                  },
                  anyOf: [
                    {
                      required: ["time"],
                    },
                  ],
                  additionalProperties: true,
                },
              },
              required: ["url", "refreshBefore"],
              additionalProperties: true,
            },
          },
          additionalProperties: true,
        },
      },
      required: [
        "restartServerAfterSeed",
        "styles",
        "datas",
        "sprites",
        "fonts",
      ],
      additionalProperties: false,
    },
    `${dataDir}/seed.json`
  );

  /* Read seed.json file */
  seed = JSON.parse(await fsPromise.readFile(`${dataDir}/seed.json`, "utf8"));

  /* Fix object */
  seed.tileLocks = {
    datas: Object.fromEntries(Object.keys(seed.datas).map((id) => [id, {}])),
    styles: Object.fromEntries(Object.keys(seed.styles).map((id) => [id, {}])),
    fonts: Object.fromEntries(Object.keys(seed.fonts).map((id) => [id, {}])),
    sprites: Object.fromEntries(
      Object.keys(seed.sprites).map((id) => [id, {}])
    ),
  };
}

/**
 * Load cleanup.json file
 * @param {string} dataDir
 * @returns {Promise<void>}
 */
async function loadCleanUpFile(dataDir) {
  /* Validate cleanup.json file */
  await validateJSON(
    {
      type: "object",
      properties: {
        restartServerAfterSeed: {
          type: "boolean",
        },
        styles: {
          type: "object",
          patternProperties: {
            "^(?![.-_])(?!.*[.-_]$)[a-zA-Z0-9-_]+(.[a-zA-Z0-9]+)?$": {
              type: "object",
              properties: {
                url: {
                  type: "string",
                },
                cleanUpBefore: {
                  type: "object",
                  properties: {
                    time: {
                      type: "string",
                    },
                  },
                  anyOf: [
                    {
                      required: ["time"],
                    },
                  ],
                  additionalProperties: true,
                },
              },
              required: ["url", "cleanUpBefore"],
              additionalProperties: true,
            },
          },
          additionalProperties: true,
        },
        datas: {
          type: "object",
          patternProperties: {
            "^(?![.-_])(?!.*[.-_]$)[a-zA-Z0-9-_]+(.[a-zA-Z0-9]+)?$": {
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
                },
                format: {
                  type: "string",
                  enum: ["gif", "png", "jpg", "jpeg", "webp", "pbf"],
                },
                bounds: {
                  type: "array",
                  items: {
                    type: "number",
                  },
                  minItems: 4,
                  maxItems: 4,
                },
                center: {
                  type: "array",
                  items: {
                    type: "number",
                  },
                  minItems: 3,
                  maxItems: 3,
                },
                zooms: {
                  type: "array",
                  items: {
                    type: "integer",
                  },
                  maxItems: 23,
                },
                scheme: {
                  type: "string",
                  enum: ["xyz", "tms"],
                },
                cleanUpBefore: {
                  type: "object",
                  properties: {
                    time: {
                      type: "string",
                    },
                  },
                  anyOf: [
                    {
                      required: ["time"],
                    },
                  ],
                  additionalProperties: true,
                },
                timeout: {
                  type: "integer",
                },
                concurrency: {
                  type: "integer",
                },
                maxTry: {
                  type: "integer",
                  minimum: 1,
                },
              },
              required: [
                "name",
                "description",
                "url",
                "format",
                "bounds",
                "center",
                "zooms",
                "scheme",
                "type",
                "cleanUpBefore",
                "timeout",
                "concurrency",
                "maxTry",
              ],
              additionalProperties: true,
            },
          },
          additionalProperties: true,
        },
        sprites: {
          type: "object",
          patternProperties: {
            "^(?![.-_])(?!.*[.-_]$)[a-zA-Z0-9-_]+(.[a-zA-Z0-9]+)?$": {
              type: "object",
              properties: {
                url: {
                  type: "string",
                },
                cleanUpBefore: {
                  type: "object",
                  properties: {
                    time: {
                      type: "string",
                    },
                  },
                  anyOf: [
                    {
                      required: ["time"],
                    },
                  ],
                  additionalProperties: true,
                },
              },
              required: ["url", "cleanUpBefore"],
              additionalProperties: true,
            },
          },
          additionalProperties: true,
        },
        fonts: {
          type: "object",
          patternProperties: {
            "^(?![.-_])(?!.*[.-_]$)[a-zA-Z0-9-_]+(.[a-zA-Z0-9]+)?$": {
              type: "object",
              properties: {
                url: {
                  type: "string",
                },
                cleanUpBefore: {
                  type: "object",
                  properties: {
                    time: {
                      type: "string",
                    },
                  },
                  anyOf: [
                    {
                      required: ["time"],
                    },
                  ],
                  additionalProperties: true,
                },
              },
              required: ["url", "cleanUpBefore"],
              additionalProperties: true,
            },
          },
          additionalProperties: true,
        },
      },
      required: [
        "restartServerAfterSeed",
        "styles",
        "datas",
        "sprites",
        "fonts",
      ],
      additionalProperties: false,
    },
    `${dataDir}/seed.json`
  );

  /* Read cleanup.json file */
  cleanUp = JSON.parse(
    await fsPromise.readFile(`${dataDir}/cleanup.json`, "utf8")
  );
}

export { loadConfigFile, loadSeedFile, loadCleanUpFile, config, seed, cleanUp };
