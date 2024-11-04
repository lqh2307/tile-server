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
            listenPort: { type: "integer" },
            killEndpoint: { type: "boolean" },
            restartEndpoint: { type: "boolean" },
            configEndpoint: { type: "boolean" },
            frontPage: { type: "boolean" },
            serveWMTS: { type: "boolean" },
            serveRendered: { type: "boolean" },
            maxScaleRender: { type: "number", minimum: 1 },
            renderedCompression: { type: "integer", minimum: 1, maximum: 9 },
            serveSwagger: { type: "boolean" },
            createMetadataIndex: { type: "boolean" },
            createTilesIndex: { type: "boolean" },
            loggerFormat: { type: "string" },
            minPoolSize: { type: "integer", minimum: 1 },
            maxPoolSize: { type: "integer", minimum: 1 },
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
          additionalProperties: {
            type: "object",
            properties: {
              style: { type: "string" },
            },
            required: ["style"],
            additionalProperties: false,
          },
        },
        datas: {
          type: "object",
          additionalProperties: {
            type: "object",
            properties: {
              mbtiles: { type: "string" },
              pmtiles: { type: "string" },
              xyz: { type: "string" },
              cache: { type: "boolean" },
            },
            additionalProperties: false,
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
      additionalProperties: false,
    },
    `${dataDir}/config.json`
  );

  /* Read config.json file */
  config = JSON.parse(
    await fsPromise.readFile(`${dataDir}/config.json`, "utf8")
  );

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
          additionalProperties: {
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
                required: ["time"],
                additionalProperties: false,
              },
            },
            required: ["url", "refreshBefore"],
            additionalProperties: false,
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
                required: ["time"],
                additionalProperties: false,
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
              "refreshBefore",
              "timeout",
              "concurrency",
              "maxTry",
            ],
            additionalProperties: false,
          },
        },
        sprites: {
          type: "object",
          additionalProperties: {
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
                required: ["time"],
                additionalProperties: false,
              },
            },
            required: ["url", "refreshBefore"],
            additionalProperties: false,
          },
        },
        fonts: {
          type: "object",
          additionalProperties: {
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
                required: ["time"],
                additionalProperties: false,
              },
            },
            required: ["url", "refreshBefore"],
            additionalProperties: false,
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
          additionalProperties: {
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
                required: ["time"],
                additionalProperties: false,
              },
            },
            required: ["url", "cleanUpBefore"],
            additionalProperties: false,
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
                required: ["time"],
                additionalProperties: false,
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
              "cleanUpBefore",
              "timeout",
              "concurrency",
              "maxTry",
            ],
            additionalProperties: false,
          },
        },
        sprites: {
          type: "object",
          additionalProperties: {
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
                required: ["time"],
                additionalProperties: false,
              },
            },
            required: ["url", "cleanUpBefore"],
            additionalProperties: false,
          },
        },
        fonts: {
          type: "object",
          additionalProperties: {
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
                required: ["time"],
                additionalProperties: false,
              },
            },
            required: ["url", "cleanUpBefore"],
            additionalProperties: false,
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
