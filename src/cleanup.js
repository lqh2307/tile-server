"use strict";

import { validateJSON } from "./utils.js";
import fsPromise from "node:fs/promises";

/**
 * Read cleanup.json file
 * @param {string} dataDir The data directory
 * @param {boolean} isValidate Is validate file?
 * @returns {Promise<object>}
 */
export async function readCleanUpFile(dataDir, isValidate) {
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
