"use strict";

import { validateJSON } from "./utils.js";
import fsPromise from "node:fs/promises";

/**
 * Read seed.json file
 * @param {string} dataDir The data directory
 * @param {boolean} isValidate Is validate file?
 * @returns {Promise<object>}
 */
export async function readSeedFile(dataDir, isValidate) {
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
                metadata: {
                  type: "object",
                  properties: {
                    name: {
                      type: "string",
                    },
                    zoom: {
                      type: "integer",
                      minimum: 0,
                      maximum: 22,
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
                  },
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
                  },
                  anyOf: [{ required: ["time"] }, { required: ["day"] }],
                  additionalProperties: true,
                },
                timeout: {
                  type: "integer",
                  minimum: 0,
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
                  },
                  anyOf: [{ required: ["time"] }, { required: ["day"] }],
                  additionalProperties: true,
                },
                timeout: {
                  type: "integer",
                  minimum: 0,
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
                  },
                  anyOf: [{ required: ["time"] }, { required: ["day"] }],
                  additionalProperties: true,
                },
                timeout: {
                  type: "integer",
                  minimum: 0,
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
        },
        required: ["styles", "datas", "sprites", "fonts"],
        additionalProperties: true,
      },
      seed
    );
  }

  return seed;
}
