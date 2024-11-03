"use strict";

export const configSchema = {
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
          additionalProperties: false,
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
          additionalProperties: false,
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
      additionalProperties: false,
    },
    sprites: {
      type: "object",
      patternProperties: {
        "^(?![.-_])(?!.*[.-_]$)[a-zA-Z0-9-_]+(.[a-zA-Z0-9]+)?$": {
          type: "boolean",
        },
      },
      additionalProperties: false,
    },
    fonts: {
      type: "object",
      patternProperties: {
        "^(?![.-_])(?!.*[.-_]$)[a-zA-Z0-9-_]+(.[a-zA-Z0-9]+)?$": {
          type: "boolean",
        },
      },
      additionalProperties: false,
    },
  },
  required: ["options", "styles", "datas", "sprites", "fonts"],
  additionalProperties: false,
};

export const seedSchema = {
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
              format: "uri",
            },
            refreshBefore: {
              type: "object",
              properties: {
                time: {
                  type: "string",
                  format: "date-time",
                },
              },
              anyOf: [
                {
                  required: ["time"],
                },
              ],
              additionalProperties: false,
            },
          },
          required: ["url", "refreshBefore"],
          additionalProperties: false,
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
            name: {
              type: "string",
            },
            description: {
              type: "string",
            },
            url: {
              type: "string",
              format: "uri",
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
                  format: "date-time",
                },
              },
              anyOf: [
                {
                  required: ["time"],
                },
              ],
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
            "type",
            "refreshBefore",
            "timeout",
            "concurrency",
            "maxTry",
          ],
          additionalProperties: false,
        },
      },
      additionalProperties: false,
    },
    sprites: {
      type: "object",
      patternProperties: {
        "^(?![.-_])(?!.*[.-_]$)[a-zA-Z0-9-_]+(.[a-zA-Z0-9]+)?$": {
          type: "object",
          properties: {
            url: {
              type: "string",
              format: "uri",
            },
            refreshBefore: {
              type: "object",
              properties: {
                time: {
                  type: "string",
                  format: "date-time",
                },
              },
              anyOf: [
                {
                  required: ["time"],
                },
              ],
              additionalProperties: false,
            },
          },
          required: ["url", "refreshBefore"],
          additionalProperties: false,
        },
      },
      additionalProperties: false,
    },
    fonts: {
      type: "object",
      patternProperties: {
        "^(?![.-_])(?!.*[.-_]$)[a-zA-Z0-9-_]+(.[a-zA-Z0-9]+)?$": {
          type: "object",
          properties: {
            url: {
              type: "string",
              format: "uri",
            },
            refreshBefore: {
              type: "object",
              properties: {
                time: {
                  type: "string",
                  format: "date-time",
                },
              },
              anyOf: [
                {
                  required: ["time"],
                },
              ],
              additionalProperties: false,
            },
          },
          required: ["url", "refreshBefore"],
          additionalProperties: false,
        },
      },
      additionalProperties: false,
    },
  },
  required: ["restartServerAfterSeed", "styles", "datas", "sprites", "fonts"],
  additionalProperties: false,
};

export const cleanUpSchema = {
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
              format: "uri",
            },
            cleanUpBefore: {
              type: "object",
              properties: {
                time: {
                  type: "string",
                  format: "date-time",
                },
              },
              anyOf: [
                {
                  required: ["time"],
                },
              ],
              additionalProperties: false,
            },
          },
          required: ["url", "cleanUpBefore"],
          additionalProperties: false,
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
            name: {
              type: "string",
            },
            description: {
              type: "string",
            },
            url: {
              type: "string",
              format: "uri",
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
                  format: "date-time",
                },
              },
              anyOf: [
                {
                  required: ["time"],
                },
              ],
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
            "type",
            "cleanUpBefore",
            "timeout",
            "concurrency",
            "maxTry",
          ],
          additionalProperties: false,
        },
      },
      additionalProperties: false,
    },
    sprites: {
      type: "object",
      patternProperties: {
        "^(?![.-_])(?!.*[.-_]$)[a-zA-Z0-9-_]+(.[a-zA-Z0-9]+)?$": {
          type: "object",
          properties: {
            url: {
              type: "string",
              format: "uri",
            },
            cleanUpBefore: {
              type: "object",
              properties: {
                time: {
                  type: "string",
                  format: "date-time",
                },
              },
              anyOf: [
                {
                  required: ["time"],
                },
              ],
              additionalProperties: false,
            },
          },
          required: ["url", "cleanUpBefore"],
          additionalProperties: false,
        },
      },
      additionalProperties: false,
    },
    fonts: {
      type: "object",
      patternProperties: {
        "^(?![.-_])(?!.*[.-_]$)[a-zA-Z0-9-_]+(.[a-zA-Z0-9]+)?$": {
          type: "object",
          properties: {
            url: {
              type: "string",
              format: "uri",
            },
            cleanUpBefore: {
              type: "object",
              properties: {
                time: {
                  type: "string",
                  format: "date-time",
                },
              },
              anyOf: [
                {
                  required: ["time"],
                },
              ],
              additionalProperties: false,
            },
          },
          required: ["url", "cleanUpBefore"],
          additionalProperties: false,
        },
      },
      additionalProperties: false,
    },
  },
  required: ["restartServerAfterSeed", "styles", "datas", "sprites", "fonts"],
  additionalProperties: false,
};
