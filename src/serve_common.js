"use strict";

import { countPostgreSQLTiles, getPostgreSQLSize } from "./tile_postgresql.js";
import { checkReadyMiddleware } from "./middleware.js";
import { countMBTilesTiles } from "./tile_mbtiles.js";
import { config, readConfigFile } from "./config.js";
import { StatusCodes } from "http-status-codes";
import { readCleanUpFile } from "./cleanup.js";
import { seed, readSeedFile } from "./seed.js";
import { countXYZTiles } from "./tile_xyz.js";
import swaggerUi from "swagger-ui-express";
import fsPromise from "node:fs/promises";
import swaggerJsdoc from "swagger-jsdoc";
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
  getVersion,
  findFiles,
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
      let configJSON = await readConfigFile(false);

      if (req.query.type === "seed") {
        configJSON = await readSeedFile(false);
      } else if (req.query.type === "cleanUp") {
        configJSON = await readCleanUpFile(false);
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
 * Get all data summary handler
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

        // Fonts info
        for (const id in seed.fonts) {
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
        }

        // Sprites info
        for (const id in seed.sprites) {
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
        }

        // Datas info
        for (const id in seed.datas) {
          const item = seed.datas[id];

          switch (item.storeType) {
            case "mbtiles": {
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

              break;
            }

            case "xyz": {
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
        }

        // Styles info
        for (const id in seed.styles) {
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
        }

        // GeoJSONs info
        for (const id in seed.geojsons) {
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
        }
      } else {
        result = {
          font: {
            count: 0,
            size: 0,
          },
          sprite: {
            count: 0,
            size: 0,
          },
          data: {
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
            xyz: {
              count: 0,
              size: 0,
            },
            pg: {
              count: 0,
              size: 0,
            },
          },
          geojson: {
            count: 0,
            size: 0,
          },
          style: {
            count: 0,
            size: 0,
          },
          rendered: {
            count: 0,
          },
        };

        // Fonts info
        for (const id in config.repo.fonts) {
          const dirPath = `${process.env.DATA_DIR}/fonts/${id}`;
          const fileNames = await findFiles(
            dirPath,
            /^\d{1,5}-\d{1,5}\.pbf$/,
            true
          );

          result.font.count += 1;

          for (const fileName of fileNames) {
            const stat = await fsPromise.stat(`${dirPath}/${fileName}`);

            result.font.size += stat.size;
          }
        }

        // Sprites info
        for (const id in config.repo.sprites) {
          const dirPath = `${process.env.DATA_DIR}/sprites/${id}`;
          const fileNames = await findFiles(
            dirPath,
            /^sprite(@\d+x)?\.(json|png)$/,
            true
          );

          result.sprite.count += 1;

          for (const fileName of fileNames) {
            const stat = await fsPromise.stat(`${dirPath}/${fileName}`);

            result.sprite.size += stat.size;
          }
        }

        // Datas info
        for (const id in config.repo.datas) {
          const item = config.repo.datas[id];

          if (item.sourceType === "mbtiles") {
            const stat = await fsPromise.stat(item.path);

            result.data.mbtiles.size += stat.size;
            result.data.mbtiles.count += 1;
          } else if (item.sourceType === "pmtiles") {
            if (
              item.path.startsWith("https://") !== true &&
              item.path.startsWith("http://") !== true
            ) {
              const stat = await fsPromise.stat(item.path);

              result.data.pmtiles.size += stat.size;
            }

            result.data.pmtiles.count += 1;
          } else if (item.sourceType === "xyz") {
            const fileNames = await findFiles(
              item.path,
              /^\d+\.(gif|png|jpg|jpeg|webp|pbf)$/,
              true
            );

            for (const fileName of fileNames) {
              const stat = await fsPromise.stat(`${item.path}/${fileName}`);

              result.data.xyz.size += stat.size;
            }

            result.data.xyz.count += 1;
          } else if (item.sourceType === "pg") {
            result.data.pg.size += await getPostgreSQLSize(item.source, id);
            result.data.pg.count += 1;
          }
        }

        result.data.count =
          result.data.mbtiles.count +
          result.data.pmtiles.count +
          result.data.xyz.count +
          result.data.pg.count;
        result.data.size =
          result.data.mbtiles.size +
          result.data.pmtiles.size +
          result.data.xyz.size +
          result.data.pg.size;

        // Styles info
        for (const id in config.repo.styles) {
          const item = config.repo.styles[id];

          try {
            const stat = await fsPromise.stat(item.path);

            result.style.size += stat.size;
          } catch (error) {
            if (item.cache === undefined && error.code === "ENOENT") {
              throw error;
            }
          }

          result.style.count += 1;

          // Rendereds info
          if (item.rendered !== undefined) {
            result.rendered.count += 1;
          }
        }

        // GeoJSONs info
        for (const id in config.repo.geojsons) {
          for (const layer in config.repo.geojsons[id]) {
            const item = config.repo.geojsons[id][layer];

            try {
              const stat = await fsPromise.stat(item.path);

              result.geojson.size += stat.size;
            } catch (error) {
              if (item.cache === undefined && error.code === "ENOENT") {
                throw error;
              }
            }
          }

          result.geojson.count += 1;
        }
      }

      res.header("content-type", "application/json");

      return res.status(StatusCodes.OK).send(result);
    } catch (error) {
      printLog("error", `Failed to get info": ${error}`);

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
     */
    app.get("/config", serveConfigHandler());

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
