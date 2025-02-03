"use strict";

import { countPostgreSQLTiles, getPostgreSQLSize } from "./tile_postgresql.js";
import { updateConfigFile, readConfigFile, config } from "./config.js";
import { countMBTilesTiles, getMBTilesSize } from "./tile_mbtiles.js";
import { updateCleanUpFile, readCleanUpFile } from "./cleanup.js";
import { seed, readSeedFile, updateSeedFile } from "./seed.js";
import { countXYZTiles, getXYZSize } from "./tile_xyz.js";
import { checkReadyMiddleware } from "./middleware.js";
import { getPMTilesSize } from "./tile_pmtiles.js";
import { StatusCodes } from "http-status-codes";
import { getGeoJSONSize } from "./geojson.js";
import { getSpriteSize } from "./sprite.js";
import swaggerUi from "swagger-ui-express";
import { getStyleSize } from "./style.js";
import fsPromise from "node:fs/promises";
import swaggerJsdoc from "swagger-jsdoc";
import { getFontSize } from "./font.js";
import { printLog } from "./logger.js";
import handlebars from "handlebars";
import express from "express";
import {
  getTilesBoundsFromBBoxs,
  getXYZFromLonLatZ,
  getBBoxFromCircle,
  getBBoxFromPoint,
  getRequestHost,
  isExistFolder,
  validateJSON,
  getVersion,
} from "./utils.js";

/**
 * Compile template
 * @param {string} template
 * @param {object} data
 * @returns {Promise<string>}
 */
async function compileTemplate(template, data) {
  const fileData = await fsPromise.readFile(
    `public/templates/${template}.tmpl`,
    "utf8"
  );

  return handlebars.compile(fileData)(data);
}

/**
 * Serve front page handler
 * @returns {(req: any, res: any, next: any) => Promise<any>}
 */
function serveFrontPageHandler() {
  return async (req, res, next) => {
    try {
      const styles = {};
      const geojsons = {};
      const geojsonGroups = {};
      const datas = {};
      const fonts = {};
      const sprites = {};

      const requestHost = getRequestHost(req);

      await Promise.all([
        ...Object.keys(config.repo.styles).map(async (id) => {
          const style = config.repo.styles[id];

          if (style.rendered !== undefined) {
            const { name, center } = style.rendered.tileJSON;

            const [x, y, z] = getXYZFromLonLatZ(
              center[0],
              center[1],
              center[2]
            );

            styles[id] = {
              name: name,
              viewer_hash: `#${center[2]}/${center[1]}/${center[0]}`,
              thumbnail: `${requestHost}/styles/${id}/${z}/${x}/${y}.png`,
              cache: style.storeCache === true,
            };
          } else {
            const { name, zoom, center } = style;

            styles[id] = {
              name: name,
              viewer_hash: `#${zoom}/${center[1]}/${center[0]}`,
              cache: style.storeCache === true,
            };
          }
        }),
        ...Object.keys(config.repo.geojsons).map(async (id) => {
          Object.keys(config.repo.geojsons[id]).map(async (layer) => {
            geojsons[`${id}/${layer}`] = {
              group: id,
              layer: layer,
              cache: config.repo.geojsons[id][layer].storeCache === true,
            };
          });
        }),
        ...Object.keys(config.repo.geojsons).map(async (id) => {
          geojsonGroups[id] = true;
        }),
        ...Object.keys(config.repo.datas).map(async (id) => {
          const data = config.repo.datas[id];
          const { name, center, format } = data.tileJSON;

          let thumbnail;
          if (format !== "pbf") {
            const [x, y, z] = getXYZFromLonLatZ(
              center[0],
              center[1],
              center[2]
            );

            thumbnail = `${requestHost}/datas/${id}/${z}/${x}/${y}.${format}`;
          }

          datas[id] = {
            name: name,
            format: format,
            viewer_hash: `#${center[2]}/${center[1]}/${center[0]}`,
            thumbnail: thumbnail,
            source_type: data.sourceType,
            cache: data.storeCache === true,
          };
        }),
        ...Object.keys(config.repo.fonts).map(async (id) => {
          fonts[id] = true;
        }),
        ...Object.keys(config.repo.sprites).map(async (id) => {
          sprites[id] = true;
        }),
      ]);

      const compiled = await compileTemplate("index", {
        styles: styles,
        geojsons: geojsons,
        geojson_groups: geojsonGroups,
        datas: datas,
        fonts: fonts,
        sprites: sprites,
        style_count: Object.keys(styles).length,
        geojson_count: Object.keys(geojsons).length,
        geojson_group_count: Object.keys(geojsonGroups).length,
        data_count: Object.keys(datas).length,
        font_count: Object.keys(fonts).length,
        sprite_count: Object.keys(sprites).length,
        base_url: requestHost,
      });

      return res.status(StatusCodes.OK).send(compiled);
    } catch (error) {
      printLog("error", `Failed to serve front page": ${error}`);

      return res
        .status(StatusCodes.INTERNAL_SERVER_ERROR)
        .send("Internal server error");
    }
  };
}

/**
 * Serve style handler
 * @returns {(req: any, res: any, next: any) => Promise<any>}
 */
function serveStyleHandler() {
  return async (req, res, next) => {
    const id = req.params.id;

    try {
      const item = config.repo.styles[id];

      if (item === undefined) {
        return res.status(StatusCodes.NOT_FOUND).send("Style does not exist");
      }

      const compiled = await compileTemplate("viewer", {
        id: id,
        name: item.name,
        base_url: getRequestHost(req),
      });

      return res.status(StatusCodes.OK).send(compiled);
    } catch (error) {
      printLog("error", `Failed to serve style "${id}": ${error}`);

      return res
        .status(StatusCodes.INTERNAL_SERVER_ERROR)
        .send("Internal server error");
    }
  };
}

/**
 * Serve data handler
 * @returns {(req: any, res: any, next: any) => Promise<any>}
 */
function serveDataHandler() {
  return async (req, res, next) => {
    const id = req.params.id;

    try {
      const item = config.repo.datas[id];

      if (item === undefined) {
        return res.status(StatusCodes.NOT_FOUND).send("Data does not exist");
      }

      const compiled = await compileTemplate(
        item.tileJSON.format === "pbf" ? "vector_data" : "raster_data",
        {
          id: id,
          name: item.tileJSON.name,
          base_url: getRequestHost(req),
        }
      );

      return res.status(StatusCodes.OK).send(compiled);
    } catch (error) {
      printLog("error", `Failed to serve data "${id}": ${error}`);

      return res
        .status(StatusCodes.INTERNAL_SERVER_ERROR)
        .send("Internal server error");
    }
  };
}

/**
 * Serve GeoJSON group handler
 * @returns {(req: any, res: any, next: any) => Promise<any>}
 */
function serveGeoJSONGroupHandler() {
  return async (req, res, next) => {
    const id = req.params.id;

    try {
      const item = config.repo.geojsons[id];

      if (item === undefined) {
        return res
          .status(StatusCodes.NOT_FOUND)
          .send("GeoJSON group does not exist");
      }

      const compiled = await compileTemplate("geojson_group", {
        id: id,
        base_url: getRequestHost(req),
      });

      return res.status(StatusCodes.OK).send(compiled);
    } catch (error) {
      printLog("error", `Failed to serve geojson group "${id}": ${error}`);

      return res
        .status(StatusCodes.INTERNAL_SERVER_ERROR)
        .send("Internal server error");
    }
  };
}

/**
 * Serve GeoJSON handler
 * @returns {(req: any, res: any, next: any) => Promise<any>}
 */
function serveGeoJSONHandler() {
  return async (req, res, next) => {
    const id = req.params.id;

    try {
      const item = config.repo.geojsons[id];

      if (item === undefined) {
        return res
          .status(StatusCodes.NOT_FOUND)
          .send("GeoJSON group does not exist");
      }

      if (item[req.params.layer] === undefined) {
        return res
          .status(StatusCodes.NOT_FOUND)
          .send("GeoJSON layer does not exist");
      }

      const compiled = await compileTemplate("geojson", {
        group: id,
        layer: req.params.layer,
        base_url: getRequestHost(req),
      });

      return res.status(StatusCodes.OK).send(compiled);
    } catch (error) {
      printLog(
        "error",
        `Failed to serve GeoJSON group "${id}" - Layer "${req.params.layer}": ${error}`
      );

      return res
        .status(StatusCodes.INTERNAL_SERVER_ERROR)
        .send("Internal server error");
    }
  };
}

/**
 * Serve WMTS handler
 * @returns {(req: any, res: any, next: any) => Promise<any>}
 */
function serveWMTSHandler() {
  return async (req, res, next) => {
    const id = req.params.id;

    try {
      const item = config.repo.styles[id].rendered;

      if (item === undefined) {
        return res.status(StatusCodes.NOT_FOUND).send("WMTS does not exist");
      }

      const compiled = await compileTemplate("wmts", {
        id: id,
        name: item.tileJSON.name,
        base_url: getRequestHost(req),
      });

      res.header("content-type", "text/xml");

      return res.status(StatusCodes.OK).send(compiled);
    } catch (error) {
      printLog("error", `Failed to serve WMTS "${id}": ${error}`);

      return res
        .status(StatusCodes.INTERNAL_SERVER_ERROR)
        .send("Internal server error");
    }
  };
}

/**
 * Serve swagger handler
 * @returns {(req: any, res: any, next: any) => Promise<any>}
 */
function serveSwagger() {
  return (req, res, next) => {
    swaggerUi.setup(
      swaggerJsdoc({
        swaggerDefinition: {
          openapi: "3.0.0",
          info: {
            title: "Tile Server API",
            version: getVersion(),
            description: "API for tile server",
          },
        },
        servers: [
          {
            url: getRequestHost(req),
            description: "Tile server",
          },
        ],
        apis: ["src/*.js"],
      })
    )(req, res, next);
  };
}

/**
 * Get config.json/seed.json/cleanUp.json content handler
 * @returns {(req: any, res: any, next: any) => Promise<any>}
 */
function serveConfigHandler() {
  return async (req, res, next) => {
    try {
      let configJSON;

      if (req.query.type === "seed") {
        configJSON = await readSeedFile(false);
      } else if (req.query.type === "cleanUp") {
        configJSON = await readCleanUpFile(false);
      } else {
        configJSON = await readConfigFile(false);
      }

      res.header("content-type", "application/json");

      return res.status(StatusCodes.OK).send(configJSON);
    } catch (error) {
      printLog("error", `Failed to get config": ${error}`);

      return res
        .status(StatusCodes.INTERNAL_SERVER_ERROR)
        .send("Internal server error");
    }
  };
}

/**
 * Update config.json/seed.json/cleanUp.json content handler
 * @returns {(req: any, res: any, next: any) => Promise<any>}
 */
function serveConfigUpdateHandler() {
  return async (req, res, next) => {
    try {
      if (req.query.type === "seed") {
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
                    },
                    url: {
                      type: "string",
                      minLength: 1,
                    },
                    skip: {
                      type: "boolean",
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
                  required: ["metadata", "url"],
                },
              },
              geojsons: {
                type: "object",
                additionalProperties: {
                  type: "object",
                  properties: {
                    url: {
                      type: "string",
                      minLength: 1,
                    },
                    skip: {
                      type: "boolean",
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
                  required: ["metadata", "url"],
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
                        scheme: {
                          type: "string",
                          enum: ["tms", "xyz"],
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
                          },
                          minItems: 0,
                        },
                        tilestats: {
                          type: "object",
                          properties: {
                            layerCount: {
                              type: "integer",
                            },
                          },
                        },
                      },
                      required: ["format"],
                    },
                    url: {
                      type: "string",
                      minLength: 1,
                    },
                    scheme: {
                      type: "string",
                      enum: ["tms", "xyz"],
                    },
                    skip: {
                      type: "boolean",
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
                    bboxs: {
                      type: "array",
                      items: {
                        type: "array",
                        items: {
                          type: "number",
                          minimum: -180,
                          maximum: 180,
                        },
                        minItems: 4,
                        maxItems: 4,
                      },
                      minItems: 1,
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
                    storeType: {
                      type: "string",
                      enum: ["xyz", "mbtiles", "pg"],
                    },
                    storeMD5: {
                      type: "boolean",
                    },
                    storeTransparent: {
                      type: "boolean",
                    },
                  },
                  required: ["metadata", "storeType", "url"],
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
                    },
                    timeout: {
                      type: "integer",
                      minimum: 0,
                    },
                    maxTry: {
                      type: "integer",
                      minimum: 1,
                    },
                    skip: {
                      type: "boolean",
                    },
                  },
                  required: ["url"],
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
                    },
                    timeout: {
                      type: "integer",
                      minimum: 0,
                    },
                    maxTry: {
                      type: "integer",
                      minimum: 1,
                    },
                    skip: {
                      type: "boolean",
                    },
                  },
                  required: ["url"],
                },
              },
            },
            required: ["styles", "geojsons", "datas", "sprites", "fonts"],
            additionalProperties: false,
          },
          req.body
        );

        const config = JSON.parse(await readSeedFile(false));

        Object.keys(req.body.styles).map((id) => {
          config.styles[id] = req.body.styles[id];
        });

        Object.keys(req.body.datas).map((id) => {
          config.datas[id] = req.body.datas[id];
        });

        Object.keys(req.body.geojsons).map((id) => {
          config.geojsons[id] = req.body.geojsons[id];
        });

        Object.keys(req.body.sprites).map((id) => {
          config.sprites[id] = req.body.sprites[id];
        });

        Object.keys(req.body.fonts).map((id) => {
          config.fonts[id] = req.body.fonts[id];
        });

        await updateSeedFile(config, 60000);
      } else if (req.query.type === "cleanUp") {
        await validateJSON(
          {
            type: "object",
            properties: {
              styles: {
                type: "object",
                additionalProperties: {
                  type: "object",
                  properties: {
                    skip: {
                      type: "boolean",
                    },
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
                    },
                  },
                },
              },
              geojsons: {
                type: "object",
                additionalProperties: {
                  type: "object",
                  properties: {
                    skip: {
                      type: "boolean",
                    },
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
                    },
                  },
                },
              },
              datas: {
                type: "object",
                additionalProperties: {
                  type: "object",
                  properties: {
                    bboxs: {
                      type: "array",
                      items: {
                        type: "array",
                        items: {
                          type: "number",
                          minimum: -180,
                          maximum: 180,
                        },
                        minItems: 4,
                        maxItems: 4,
                      },
                      minItems: 1,
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
                    skip: {
                      type: "boolean",
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
                    },
                  },
                },
              },
              sprites: {
                type: "object",
                additionalProperties: {
                  type: "object",
                  properties: {
                    skip: {
                      type: "boolean",
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
                    },
                  },
                },
              },
              fonts: {
                type: "object",
                additionalProperties: {
                  type: "object",
                  properties: {
                    skip: {
                      type: "boolean",
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
                    },
                  },
                },
              },
            },
            required: ["styles", "geojsons", "datas", "sprites", "fonts"],
            additionalProperties: false,
          },
          req.body
        );

        const config = JSON.parse(await readCleanUpFile(false));

        Object.keys(req.body.styles).map((id) => {
          config.styles[id] = req.body.styles[id];
        });

        Object.keys(req.body.datas).map((id) => {
          config.datas[id] = req.body.datas[id];
        });

        Object.keys(req.body.geojsons).map((id) => {
          config.geojsons[id] = req.body.geojsons[id];
        });

        Object.keys(req.body.sprites).map((id) => {
          config.sprites[id] = req.body.sprites[id];
        });

        Object.keys(req.body.fonts).map((id) => {
          config.fonts[id] = req.body.fonts[id];
        });

        await updateCleanUpFile(config, 60000);
      } else {
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
          req.body
        );

        const config = JSON.parse(await readConfigFile(false));

        Object.assign(config.options, req.body.options);

        Object.keys(req.body.styles).map((id) => {
          config.styles[id] = req.body.styles[id];
        });

        Object.keys(req.body.datas).map((id) => {
          config.datas[id] = req.body.datas[id];
        });

        Object.keys(req.body.geojsons).map((id) => {
          config.geojsons[id] = req.body.geojsons[id];
        });

        Object.keys(req.body.sprites).map((id) => {
          config.sprites[id] = req.body.sprites[id];
        });

        Object.keys(req.body.fonts).map((id) => {
          config.fonts[id] = req.body.fonts[id];
        });

        await updateConfigFile(config, 60000);
      }

      return res.status(StatusCodes.OK).send("OK");
    } catch (error) {
      printLog("error", `Failed to update config": ${error}`);

      if (error.validateJSON === true) {
        return res
          .status(StatusCodes.BAD_REQUEST)
          .send("Config element is invalid");
      }

      return res
        .status(StatusCodes.INTERNAL_SERVER_ERROR)
        .send("Internal server error");
    }
  };
}

/**
 * Delete config.json/seed.json/cleanUp.json content handler
 * @returns {(req: any, res: any, next: any) => Promise<any>}
 */
function serveConfigDeleteHandler() {
  return async (req, res, next) => {
    try {
      await validateJSON(
        {
          type: "object",
          properties: {
            styles: {
              type: "array",
              items: {
                type: "string",
                minLength: 1,
              },
              minItems: 1,
            },
            geojsons: {
              type: "array",
              items: {
                type: "string",
                minLength: 1,
              },
              minItems: 1,
            },
            datas: {
              type: "array",
              items: {
                type: "string",
                minLength: 1,
              },
              minItems: 1,
            },
            sprites: {
              type: "array",
              items: {
                type: "string",
                minLength: 1,
              },
              minItems: 1,
            },
            fonts: {
              type: "array",
              items: {
                type: "string",
                minLength: 1,
              },
              minItems: 1,
            },
          },
          required: ["styles", "geojsons", "datas", "sprites", "fonts"],
          additionalProperties: false,
        },
        req.body
      );

      if (req.query.type === "seed") {
        const config = JSON.parse(await readSeedFile(false));

        Object.keys(req.body.styles).map((id) => {
          delete config.styles[id];
        });

        Object.keys(req.body.datas).map((id) => {
          delete config.datas[id];
        });

        Object.keys(req.body.geojsons).map((id) => {
          delete config.geojsons[id];
        });

        Object.keys(req.body.sprites).map((id) => {
          delete config.sprites[id];
        });

        Object.keys(req.body.fonts).map((id) => {
          delete config.fonts[id];
        });

        await updateSeedFile(config, 60000);
      } else if (req.query.type === "cleanUp") {
        const config = JSON.parse(await readCleanUpFile(false));

        Object.keys(req.body.styles).map((id) => {
          delete config.styles[id];
        });

        Object.keys(req.body.datas).map((id) => {
          delete config.datas[id];
        });

        Object.keys(req.body.geojsons).map((id) => {
          delete config.geojsons[id];
        });

        Object.keys(req.body.sprites).map((id) => {
          delete config.sprites[id];
        });

        Object.keys(req.body.fonts).map((id) => {
          delete config.fonts[id];
        });

        await updateCleanUpFile(config, 60000);
      } else {
        const config = JSON.parse(await readConfigFile(false));

        Object.keys(req.body.styles).map((id) => {
          delete config.styles[id];
        });

        Object.keys(req.body.datas).map((id) => {
          delete config.datas[id];
        });

        Object.keys(req.body.geojsons).map((id) => {
          delete config.geojsons[id];
        });

        Object.keys(req.body.sprites).map((id) => {
          delete config.sprites[id];
        });

        Object.keys(req.body.fonts).map((id) => {
          delete config.fonts[id];
        });

        await updateConfigFile(config, 60000);
      }

      return res.status(StatusCodes.OK).send("OK");
    } catch (error) {
      printLog("error", `Failed to delete config": ${error}`);

      if (error.validateJSON === true) {
        return res
          .status(StatusCodes.BAD_REQUEST)
          .send("Config element is invalid");
      }

      return res
        .status(StatusCodes.INTERNAL_SERVER_ERROR)
        .send("Internal server error");
    }
  };
}

/**
 * Get summary handler
 * @returns {(req: any, res: any, next: any) => Promise<any>}
 */
function serveSummaryHandler() {
  return async (req, res, next) => {
    try {
      let result;

      if (req.query.type === "seed") {
        result = {
          styles: {},
          geojsons: {},
          datas: {},
          sprites: {},
          fonts: {},
        };

        await Promise.all([
          ...Object.keys(seed.fonts).map(async (id) => {
            if (
              (await isExistFolder(
                `${process.env.DATA_DIR}/caches/fonts/${id}`
              )) === true
            ) {
              result.fonts[id] = {
                actual: 1,
                expect: 1,
              };
            } else {
              result.fonts[id] = {
                actual: 0,
                expect: 1,
              };
            }
          }),
          ...Object.keys(seed.sprites).map(async (id) => {
            if (
              (await isExistFolder(
                `${process.env.DATA_DIR}/caches/sprites/${id}`
              )) === true
            ) {
              result.sprites[id] = {
                actual: 1,
                expect: 1,
              };
            } else {
              result.sprites[id] = {
                actual: 0,
                expect: 1,
              };
            }
          }),
          ...Object.keys(seed.datas).map(async (id) => {
            const item = seed.datas[id];

            switch (item.storeType) {
              case "mbtiles": {
                try {
                  result.datas[id] = {
                    actual: await countMBTilesTiles(
                      `${process.env.DATA_DIR}/caches/mbtiles/${id}/${id}.mbtiles`
                    ),
                    expect: getTilesBoundsFromBBoxs(
                      item.bboxs,
                      item.zooms,
                      item.scheme
                    ).total,
                  };
                } catch (error) {
                  if (error.code !== "ENOENT") {
                    throw error;
                  } else {
                    result.datas[id] = {
                      actual: 0,
                      expect: getTilesBoundsFromBBoxs(
                        item.bboxs,
                        item.zooms,
                        item.scheme
                      ).total,
                    };
                  }
                }

                break;
              }

              case "xyz": {
                try {
                  result.datas[id] = {
                    actual: await countXYZTiles(
                      `${process.env.DATA_DIR}/caches/xyzs/${id}`
                    ),
                    expect: getTilesBoundsFromBBoxs(
                      item.bboxs,
                      item.zooms,
                      item.scheme
                    ).total,
                  };
                } catch (error) {
                  if (error.code !== "ENOENT") {
                    throw error;
                  } else {
                    result.datas[id] = {
                      actual: 0,
                      expect: getTilesBoundsFromBBoxs(
                        item.bboxs,
                        item.zooms,
                        item.scheme
                      ).total,
                    };
                  }
                }

                break;
              }

              case "pg": {
                result.datas[id] = {
                  actual: await countPostgreSQLTiles(
                    `${process.env.POSTGRESQL_BASE_URI}/${id}`
                  ),
                  expect: getTilesBoundsFromBBoxs(
                    item.bboxs,
                    item.zooms,
                    item.scheme
                  ).total,
                };

                break;
              }
            }
          }),
          ...Object.keys(seed.styles).map(async (id) => {
            if (
              (await isExistFolder(
                `${process.env.DATA_DIR}/caches/styles/${id}`
              )) === true
            ) {
              result.styles[id] = {
                actual: 1,
                expect: 1,
              };
            } else {
              result.styles[id] = {
                actual: 0,
                expect: 1,
              };
            }
          }),
          ...Object.keys(seed.geojsons).map(async (id) => {
            if (
              (await isExistFolder(
                `${process.env.DATA_DIR}/caches/geojsons/${id}`
              )) === true
            ) {
              result.geojsons[id] = {
                actual: 1,
                expect: 1,
              };
            } else {
              result.geojsons[id] = {
                actual: 0,
                expect: 1,
              };
            }
          }),
        ]);
      } else {
        result = {
          fonts: {
            count: 0,
            size: 0,
          },
          sprites: {
            count: 0,
            size: 0,
          },
          datas: {
            count: 0,
            size: 0,
            mbtiles: {
              count: 0,
              size: 0,
            },
            pmtiles: {
              count: 0,
              size: 0,
            },
            xyzs: {
              count: 0,
              size: 0,
            },
            pgs: {
              count: 0,
              size: 0,
            },
          },
          geojsonGroups: {
            count: 0,
            geojsons: {
              count: 0,
              size: 0,
            },
          },
          styles: {
            count: 0,
            size: 0,
            rendereds: {
              count: 0,
            },
          },
        };

        await Promise.all([
          ...Object.keys(config.repo.fonts).map(async (id) => {
            result.fonts.size += await getFontSize(
              `${process.env.DATA_DIR}/fonts/${id}`
            );
            result.fonts.count += 1;
          }),
          ...Object.keys(config.repo.sprites).map(async (id) => {
            result.sprites.size += await getSpriteSize(
              `${process.env.DATA_DIR}/sprites/${id}`
            );
            result.sprites.count += 1;
          }),
          ...Object.keys(config.repo.datas).map(async (id) => {
            const item = config.repo.datas[id];

            switch (item.sourceType) {
              case "mbtiles": {
                try {
                  result.datas.mbtiles.size += await getMBTilesSize(item.path);
                } catch (error) {
                  if (!(item.cache !== undefined && error.code === "ENOENT")) {
                    throw error;
                  }
                }

                result.datas.mbtiles.count += 1;

                break;
              }

              case "pmtiles": {
                if (
                  item.path.startsWith("https://") !== true &&
                  item.path.startsWith("http://") !== true
                ) {
                  result.datas.pmtiles.size += await getPMTilesSize(item.path);
                }

                result.datas.pmtiles.count += 1;

                break;
              }

              case "xyz": {
                try {
                  result.datas.xyzs.size += await getXYZSize(item.path);
                } catch (error) {
                  if (!(item.cache !== undefined && error.code === "ENOENT")) {
                    throw error;
                  }
                }

                result.datas.xyzs.count += 1;

                break;
              }

              case "pg": {
                result.datas.pgs.size += await getPostgreSQLSize(
                  item.source,
                  id
                );
                result.datas.pgs.count += 1;

                break;
              }
            }
          }),
          ...Object.keys(config.repo.styles).map(async (id) => {
            const item = config.repo.styles[id];

            try {
              result.styles.size += await getStyleSize(item.path);
            } catch (error) {
              if (!(item.cache !== undefined && error.code === "ENOENT")) {
                throw error;
              }
            }

            result.styles.count += 1;

            // Rendereds info
            if (item.rendered !== undefined) {
              result.styles.rendereds.count += 1;
            }
          }),
          ...Object.keys(config.repo.geojsons).map(async (id) => {
            for (const layer in config.repo.geojsons[id]) {
              const item = config.repo.geojsons[id][layer];

              try {
                result.geojsonGroups.geojsons.size += await getGeoJSONSize(
                  item.path
                );
              } catch (error) {
                if (!(item.cache !== undefined && error.code === "ENOENT")) {
                  throw error;
                }
              }

              result.geojsonGroups.geojsons.count += 1;
            }

            result.geojsonGroups.count += 1;
          }),
        ]);

        result.datas.count =
          result.datas.mbtiles.count +
          result.datas.pmtiles.count +
          result.datas.xyzs.count +
          result.datas.pgs.count;
        result.datas.size =
          result.datas.mbtiles.size +
          result.datas.pmtiles.size +
          result.datas.xyzs.size +
          result.datas.pgs.size;
      }

      res.header("content-type", "application/json");

      return res.status(StatusCodes.OK).send(result);
    } catch (error) {
      printLog("error", `Failed to get summary": ${error}`);

      return res
        .status(StatusCodes.INTERNAL_SERVER_ERROR)
        .send("Internal server error");
    }
  };
}

/**
 * Get health of server handler
 * @returns {(req: any, res: any, next: any) => Promise<any>}
 */
function serveHealthHandler() {
  return async (req, res, next) => {
    try {
      return res.status(StatusCodes.OK).send("OK");
    } catch (error) {
      printLog("error", `Failed to check health server": ${error}`);

      return res
        .status(StatusCodes.INTERNAL_SERVER_ERROR)
        .send("Internal server error");
    }
  };
}

/**
 * Restart/kill server handler
 * @returns {(req: any, res: any, next: any) => Promise<any>}
 */
function serveRestartKillHandler() {
  return async (req, res, next) => {
    try {
      if (req.query.type === "kill") {
        setTimeout(
          () =>
            process.send({
              action: "killServer",
            }),
          0
        );
      } else {
        setTimeout(
          () =>
            process.send({
              action: "restartServer",
            }),
          0
        );
      }

      return res.status(StatusCodes.OK).send("OK");
    } catch (error) {
      printLog("error", `Failed to restart/kill server": ${error}`);

      return res
        .status(StatusCodes.INTERNAL_SERVER_ERROR)
        .send("Internal server error");
    }
  };
}

/**
 * Calculate handler
 * @returns {(req: any, res: any, next: any) => Promise<any>}
 */
function calculateHandler() {
  return async (req, res, next) => {
    try {
      if (req.query.points) {
        const parsedPoints = JSON.parse(req.query.points);

        return res.status(StatusCodes.OK).send(getBBoxFromPoint(parsedPoints));
      } else if (req.query.circle) {
        const parsedCircle = JSON.parse(req.query.circle);

        return res
          .status(StatusCodes.OK)
          .send(getBBoxFromCircle(parsedCircle.center, parsedCircle.radius));
      } else {
        return res
          .status(StatusCodes.BAD_REQUEST)
          .send("points or circle query parameter is missing");
      }
    } catch (error) {
      printLog("error", `Failed to calculate bbox: ${error}`);

      if (error instanceof SyntaxError) {
        return res
          .status(StatusCodes.BAD_REQUEST)
          .send("points or circle query parameter is invalid");
      } else {
        return res
          .status(StatusCodes.INTERNAL_SERVER_ERROR)
          .send("Internal server error");
      }
    }
  };
}

export const serve_common = {
  init: () => {
    const app = express()
      .use("/", express.static("public/resources"))
      .disable("x-powered-by");

    if (process.env.SERVE_SWAGGER !== "false") {
      app.use("/swagger/index.html", swaggerUi.serve, serveSwagger());
    }

    /**
     * @swagger
     * tags:
     *   - name: Common
     *     description: Common related endpoints
     * /calculate-bbox:
     *   get:
     *     tags:
     *       - Common
     *     summary: Calculate bbox from points or circle
     *     parameters:
     *       - in: query
     *         name: circle
     *         schema:
     *           type: object
     *         required: false
     *         description: Circle params
     *       - in: query
     *         name: points
     *         schema:
     *           type: object
     *         required: false
     *         description: Points params
     *     responses:
     *       200:
     *         description: Bounding box
     *         content:
     *           text/plain:
     *             schema:
     *               type: string
     *               example: OK
     *       400:
     *         description: Invalid query params
     *       404:
     *         description: Not found
     *       503:
     *         description: Server is starting up
     *         content:
     *           text/plain:
     *             schema:
     *               type: string
     *               example: Starting...
     *       500:
     *         description: Internal server error
     */
    app.get("/calculate-bbox", calculateHandler());

    /**
     * @swagger
     * tags:
     *   - name: Common
     *     description: Common related endpoints
     * /summary:
     *   get:
     *     tags:
     *       - Common
     *     summary: Get summary
     *     parameters:
     *       - in: query
     *         name: type
     *         schema:
     *           type: string
     *           enum: [service, seed]
     *           example: service
     *         required: false
     *         description: Summary type
     *     responses:
     *       200:
     *         description: Summary
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *       404:
     *         description: Not found
     *       503:
     *         description: Server is starting up
     *         content:
     *           text/plain:
     *             schema:
     *               type: string
     *               example: Starting...
     *       500:
     *         description: Internal server error
     */
    app.get("/summary", checkReadyMiddleware(), serveSummaryHandler());

    /**
     * @swagger
     * tags:
     *   - name: Common
     *     description: Common related endpoints
     * /health:
     *   get:
     *     tags:
     *       - Common
     *     summary: Check health of the server
     *     responses:
     *       200:
     *         description: Server is healthy
     *         content:
     *           text/plain:
     *             schema:
     *               type: string
     *               example: OK
     *       404:
     *         description: Not found
     *       503:
     *         description: Server is starting up
     *         content:
     *           text/plain:
     *             schema:
     *               type: string
     *               example: Starting...
     *       500:
     *         description: Internal server error
     */
    app.get("/health", serveHealthHandler());

    /**
     * @swagger
     * tags:
     *   - name: Common
     *     description: Common related endpoints
     * /config:
     *   get:
     *     tags:
     *       - Common
     *     summary: Get config
     *     parameters:
     *       - in: query
     *         name: type
     *         schema:
     *           type: string
     *           enum: [config, seed, cleanUp]
     *           example: config
     *         required: false
     *         description: Config type
     *     responses:
     *       200:
     *         description: Config
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *       404:
     *         description: Not found
     *       503:
     *         description: Server is starting up
     *         content:
     *           text/plain:
     *             schema:
     *               type: string
     *               example: Starting...
     *       500:
     *         description: Internal server error
     *   post:
     *     tags:
     *       - Common
     *     summary: Update config
     *     parameters:
     *       - in: query
     *         name: type
     *         schema:
     *           type: string
     *           enum: [config, seed, cleanUp]
     *           example: config
     *         required: false
     *         description: Config type
     *     responses:
     *       200:
     *         description: Config is updated
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *       400:
     *         description: Bad request
     *       404:
     *         description: Not found
     *       503:
     *         description: Server is starting up
     *         content:
     *           text/plain:
     *             schema:
     *               type: string
     *               example: Starting...
     *       500:
     *         description: Internal server error
     *   delete:
     *     tags:
     *       - Common
     *     summary: Update config
     *     parameters:
     *       - in: query
     *         name: type
     *         schema:
     *           type: string
     *           enum: [config, seed, cleanUp]
     *           example: config
     *         required: false
     *         description: Config type
     *     responses:
     *       200:
     *         description: Config is updated
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *       400:
     *         description: Bad request
     *       404:
     *         description: Not found
     *       503:
     *         description: Server is starting up
     *         content:
     *           text/plain:
     *             schema:
     *               type: string
     *               example: Starting...
     *       500:
     *         description: Internal server error
     */
    app.get("/config", serveConfigHandler());
    app.post("/config", serveConfigUpdateHandler());
    app.delete("/config", serveConfigDeleteHandler());

    if (process.env.SERVE_SERVER_ENDPOINT !== "false") {
      /**
       * @swagger
       * tags:
       *   - name: Common
       *     description: Common related endpoints
       * /restart:
       *   get:
       *     tags:
       *       - Common
       *     summary: Restart/kill the server
       *     parameters:
       *       - in: query
       *         name: type
       *         schema:
       *           type: string
       *           enum: [restart, kill]
       *           example: restart
       *         required: false
       *         description: Action type
       *     responses:
       *       200:
       *         description: Server will restart/kill
       *         content:
       *           text/plain:
       *             schema:
       *               type: string
       *               example: OK
       *       404:
       *         description: Not found
       *       503:
       *         description: Server is starting up
       *         content:
       *           text/plain:
       *             schema:
       *               type: string
       *               example: Starting...
       *       500:
       *         description: Internal server error
       */
      app.get("/restart", serveRestartKillHandler());
    }

    /**
     * @swagger
     * tags:
     *   - name: WMTS
     *     description: WMTS related endpoints
     * /styles/{id}/wmts.xml:
     *   get:
     *     tags:
     *       - WMTS
     *     summary: Get WMTS XML for style
     *     parameters:
     *       - in: path
     *         name: id
     *         schema:
     *           type: string
     *           example: id
     *         required: true
     *         description: ID of the style
     *     responses:
     *       200:
     *         description: WMTS XML for the style
     *         content:
     *           text/xml:
     *             schema:
     *               type: string
     *       404:
     *         description: Not found
     *       503:
     *         description: Server is starting up
     *         content:
     *           text/plain:
     *             schema:
     *               type: string
     *               example: Starting...
     *       500:
     *         description: Internal server error
     */
    app.get("/styles/:id/wmts.xml", checkReadyMiddleware(), serveWMTSHandler());

    if (process.env.SERVE_FRONT_PAGE !== "false") {
      /**
       * @swagger
       * tags:
       *   - name: Common
       *     description: Common related endpoints
       * /styles/{id}/:
       *   get:
       *     tags:
       *       - Common
       *     summary: Serve style page
       *     parameters:
       *       - in: path
       *         name: id
       *         schema:
       *           type: string
       *           example: id
       *         required: true
       *         description: ID of the style
       *     responses:
       *       200:
       *         description: Style page
       *         content:
       *           text/html:
       *             schema:
       *               type: string
       *       404:
       *         description: Not found
       *       503:
       *         description: Server is starting up
       *         content:
       *           text/plain:
       *             schema:
       *               type: string
       *               example: Starting...
       *       500:
       *         description: Internal server error
       */
      app.get("/styles/:id/$", checkReadyMiddleware(), serveStyleHandler());

      /**
       * @swagger
       * tags:
       *   - name: Common
       *     description: Common related endpoints
       * /geojsons/{id}/:
       *   get:
       *     tags:
       *       - Common
       *     summary: Serve GeoJSON group page
       *     parameters:
       *       - in: path
       *         name: id
       *         schema:
       *           type: string
       *           example: id
       *         required: true
       *         description: ID of the GeoJSON group
       *     responses:
       *       200:
       *         description: GeoJSON group page
       *         content:
       *           text/html:
       *             schema:
       *               type: string
       *       404:
       *         description: Not found
       *       503:
       *         description: Server is starting up
       *         content:
       *           text/plain:
       *             schema:
       *               type: string
       *               example: Starting...
       *       500:
       *         description: Internal server error
       */
      app.get(
        "/geojsons/:id/$",
        checkReadyMiddleware(),
        serveGeoJSONGroupHandler()
      );

      /**
       * @swagger
       * tags:
       *   - name: Common
       *     description: Common related endpoints
       * /geojsons/{id}/{layer}:
       *   get:
       *     tags:
       *       - Common
       *     summary: Serve GeoJSON page
       *     parameters:
       *       - in: path
       *         name: id
       *         schema:
       *           type: string
       *           example: id
       *         required: true
       *         description: ID of the geojson
       *       - in: path
       *         name: layer
       *         schema:
       *           type: string
       *           example: layer
       *         required: true
       *         description: Layer of the GeoJSON
       *     responses:
       *       200:
       *         description: GeoJSON page
       *         content:
       *           text/html:
       *             schema:
       *               type: string
       *       404:
       *         description: Not found
       *       503:
       *         description: Server is starting up
       *         content:
       *           text/plain:
       *             schema:
       *               type: string
       *               example: Starting...
       *       500:
       *         description: Internal server error
       */
      app.get(
        "/geojsons/:id/:layer/$",
        checkReadyMiddleware(),
        serveGeoJSONHandler()
      );

      /* Serve data */
      /**
       * @swagger
       * tags:
       *   - name: Common
       *     description: Common related endpoints
       * /datas/{id}/:
       *   get:
       *     tags:
       *       - Common
       *     summary: Serve data page
       *     parameters:
       *       - in: path
       *         name: id
       *         schema:
       *           type: string
       *           example: id
       *         required: true
       *         description: ID of the data
       *     responses:
       *       200:
       *         description: Data page
       *         content:
       *           text/html:
       *             schema:
       *               type: string
       *       404:
       *         description: Not found
       *       503:
       *         description: Server is starting up
       *         content:
       *           text/plain:
       *             schema:
       *               type: string
       *               example: Starting...
       *       500:
       *         description: Internal server error
       */
      app.use("/datas/:id/$", serveDataHandler());

      /* Serve front page */
      /**
       * @swagger
       * tags:
       *   - name: Common
       *     description: Common related endpoints
       * /:
       *   get:
       *     tags:
       *       - Common
       *     summary: Serve front page
       *     responses:
       *       200:
       *         description: Front page
       *         content:
       *           text/html:
       *             schema:
       *               type: string
       *       404:
       *         description: Not found
       *       503:
       *         description: Server is starting up
       *         content:
       *           text/plain:
       *             schema:
       *               type: string
       *               example: Starting...
       *       500:
       *         description: Internal server error
       */
      app.get("/$", checkReadyMiddleware(), serveFrontPageHandler());
    }

    return app;
  },
};
