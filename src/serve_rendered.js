"use strict";

import { cacheXYZTileDataFile, getXYZTileFromURL, getXYZTile } from "./xyz.js";
import { createEmptyData, processImage, renderData } from "./image.js";
import { checkReadyMiddleware } from "./middleware.js";
import mlgl from "@maplibre/maplibre-gl-native";
import { StatusCodes } from "http-status-codes";
import { getPMTilesTile } from "./pmtiles.js";
import { getMBTilesTile } from "./mbtiles.js";
import { createPool } from "generic-pool";
import { getSprite } from "./sprite.js";
import { printLog } from "./logger.js";
import { getStyle } from "./style.js";
import { config } from "./config.js";
import { getFonts } from "./font.js";
import express from "express";
import zlib from "zlib";
import {
  detectFormatAndHeaders,
  getDataFromURL,
  createMetadata,
  getRequestHost,
} from "./utils.js";

/**
 * Get rendered tile handler
 * @returns {(req: any, res: any, next: any) => Promise<any>}
 */
function getRenderedTileHandler() {
  return async (req, res, next) => {
    const id = req.params.id;
    const item = config.repo.rendereds[id];

    /* Check rendered is exist? */
    if (item === undefined) {
      return res.status(StatusCodes.NOT_FOUND).send("Rendered is not found");
    }

    /* Get and check rendered tile scale (Default: 1). Ex: @2x -> 2 */
    const scale = Number(req.params.scale?.slice(1, -1)) || 1;

    if (scale > config.options.maxScaleRender) {
      return res
        .status(StatusCodes.BAD_REQUEST)
        .send("Rendered tile scale is invalid");
    }

    /* Get tile size (Default: 256px x 256px) */
    const z = Number(req.params.z);
    const x = Number(req.params.x);
    const y = Number(req.params.y);
    const tileSize = Number(req.params.tileSize) || 256;

    /* Render tile */
    try {
      const data = await renderData(
        item,
        scale,
        tileSize,
        x,
        y,
        z,
        req.query.scheme
      );

      const image = await processImage(
        data,
        scale,
        config.options.renderedCompression,
        tileSize,
        z
      );

      res.header("Content-Type", `image/png`);

      return res.status(StatusCodes.OK).send(image);
    } catch (error) {
      printLog(
        "error",
        `Failed to get rendered "${id}" - Tile "${z}/${x}/${y}: ${error}`
      );

      return res
        .status(StatusCodes.INTERNAL_SERVER_ERROR)
        .send("Internal server error");
    }
  };
}

/**
 * Get rendered tileJSON handler
 * @returns {(req: any, res: any, next: any) => Promise<any>}
 */
function getRenderedHandler() {
  return async (req, res, next) => {
    const id = req.params.id;
    const item = config.repo.rendereds[id];

    /* Check rendered is exist? */
    if (item === undefined) {
      return res.status(StatusCodes.NOT_FOUND).send("Rendered is not found");
    }

    /* Get render info */
    try {
      res.header("Content-Type", "application/json");

      return res.status(StatusCodes.OK).send({
        ...item.tileJSON,
        tilejson: "2.2.0",
        scheme: "xyz",
        tiles: [
          `${getRequestHost(req)}styles/${id}/${
            req.params.tileSize || 256
          }/{z}/{x}/{y}.png${req.query.scheme === "tms" ? "?scheme=tms" : ""}`,
        ],
      });
    } catch (error) {
      printLog("error", `Failed to get rendered "${id}": ${error}`);

      return res
        .status(StatusCodes.INTERNAL_SERVER_ERROR)
        .send("Internal server error");
    }
  };
}

/**
 * Get rendered list handler
 * @returns {(req: any, res: any, next: any) => Promise<any>}
 */
function getRenderedsListHandler() {
  return async (req, res, next) => {
    try {
      const result = await Promise.all(
        Object.keys(config.repo.rendereds).map(async (id) => {
          return {
            id: id,
            name: config.repo.rendereds[id].tileJSON.name,
            url: [
              `${getRequestHost(req)}styles/256/${id}.json${
                req.query.scheme === "tms" ? "?scheme=tms" : ""
              }`,
              `${getRequestHost(req)}styles/512/${id}.json${
                req.query.scheme === "tms" ? "?scheme=tms" : ""
              }`,
            ],
          };
        })
      );

      return res.status(StatusCodes.OK).send(result);
    } catch (error) {
      printLog("error", `Failed to get rendereds": ${error}`);

      return res
        .status(StatusCodes.INTERNAL_SERVER_ERROR)
        .send("Internal server error");
    }
  };
}

/**
 * Get rendered tileJSON list handler
 * @returns {(req: any, res: any, next: any) => Promise<any>}
 */
function getRenderedTileJSONsListHandler() {
  return async (req, res, next) => {
    try {
      const result = await Promise.all(
        Object.keys(config.repo.rendereds).map(async (id) => {
          return {
            ...config.repo.rendereds[id].tileJSON,
            id: id,
            tilejson: "2.2.0",
            scheme: "xyz",
            tiles: [
              `${getRequestHost(req)}styles/${id}/{z}/{x}/{y}.png${
                req.query.scheme === "tms" ? "?scheme=tms" : ""
              }`,
            ],
          };
        })
      );

      return res.status(StatusCodes.OK).send(result);
    } catch (error) {
      printLog("error", `Failed to get rendered tileJSONs": ${error}`);

      return res
        .status(StatusCodes.INTERNAL_SERVER_ERROR)
        .send("Internal server error");
    }
  };
}

export const serve_rendered = {
  init: () => {
    const app = express();

    if (config.options.serveRendered === true) {
      /**
       * @swagger
       * tags:
       *   - name: Rendered
       *     description: Rendered related endpoints
       * /styles/rendereds.json:
       *   get:
       *     tags:
       *       - Rendered
       *     summary: Get all style rendereds
       *     parameters:
       *       - in: path
       *         name: tileSize
       *         schema:
       *           type: integer
       *           enum: [256, 512]
       *         required: false
       *         description: Tile size (256 or 512)
       *       - in: query
       *         name: scheme
       *         schema:
       *           type: string
       *           enum: [xyz, tms]
       *         required: false
       *         description: Use xyz or tms scheme
       *     responses:
       *       200:
       *         description: List of all style rendereds
       *         content:
       *           application/json:
       *             schema:
       *               type: array
       *               items:
       *                 type: object
       *                 properties:
       *                   id:
       *                     type: string
       *                     example: style1
       *                   name:
       *                     type: string
       *                     example: Style 1
       *                   url:
       *                     type: array
       *                     items:
       *                       type: string
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
        "/rendereds.json",
        checkReadyMiddleware(),
        getRenderedsListHandler()
      );

      /**
       * @swagger
       * tags:
       *   - name: Rendered
       *     description: Rendered related endpoints
       * /styles/tilejsons.json:
       *   get:
       *     tags:
       *       - Rendered
       *     summary: Get all rendered tileJSONs
       *     parameters:
       *       - in: query
       *         name: scheme
       *         schema:
       *           type: string
       *           enum: [xyz, tms]
       *         required: false
       *         description: Use xyz or tms scheme
       *     responses:
       *       200:
       *         description: List of all rendered tileJSONs
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
      app.get(
        "/tilejsons.json",
        checkReadyMiddleware(),
        getRenderedTileJSONsListHandler()
      );

      /**
       * @swagger
       * tags:
       *   - name: Rendered
       *     description: Rendered related endpoints
       * /styles/{tileSize}/{id}.json:
       *   get:
       *     tags:
       *       - Rendered
       *     summary: Get style rendered
       *     parameters:
       *       - in: path
       *         name: tileSize
       *         schema:
       *           type: integer
       *           enum: [256, 512]
       *         required: false
       *         description: Tile size (256 or 512)
       *       - in: path
       *         name: id
       *         schema:
       *           type: string
       *         required: true
       *         description: ID of the style rendered
       *       - in: query
       *         name: scheme
       *         schema:
       *           type: string
       *           enum: [xyz, tms]
       *         required: false
       *         description: Use xyz or tms scheme
       *     responses:
       *       200:
       *         description: Style rendered
       *         content:
       *           application/json:
       *             schema:
       *               type: object
       *               properties:
       *                 tileJSON:
       *                   type: object
       *                 tiles:
       *                   type: array
       *                   items:
       *                     type: string
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
        "/(:tileSize(256|512)/)?:id.json",
        checkReadyMiddleware(),
        getRenderedHandler()
      );

      /**
       * @swagger
       * tags:
       *   - name: Rendered
       *     description: Rendered related endpoints
       * /styles/{id}/{tileSize}/{z}/{x}/{y}{scale}.png:
       *   get:
       *     tags:
       *       - Rendered
       *     summary: Get style rendered tile
       *     parameters:
       *       - in: path
       *         name: id
       *         schema:
       *           type: string
       *         required: true
       *         description: ID of the style
       *       - in: path
       *         name: tileSize
       *         schema:
       *           type: integer
       *           enum: [256, 512]
       *         required: false
       *         description: Tile size (256 or 512)
       *       - in: path
       *         name: z
       *         schema:
       *           type: integer
       *         required: true
       *         description: Zoom level
       *       - in: path
       *         name: x
       *         schema:
       *           type: integer
       *         required: true
       *         description: X coordinate
       *       - in: path
       *         name: y
       *         schema:
       *           type: integer
       *         required: true
       *         description: Y coordinate
       *       - in: path
       *         name: scale
       *         schema:
       *           type: string
       *         required: false
       *         description: Scale of the tile (e.g., @2x)
       *       - in: query
       *         name: scheme
       *         schema:
       *           type: string
       *           enum: [xyz, tms]
       *         required: false
       *         description: Use xyz or tms scheme
       *     responses:
       *       200:
       *         description: Style tile
       *         content:
       *           image/png:
       *             schema:
       *               type: string
       *               format: binary
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
        `/:id/(:tileSize(256|512)/)?:z(\\d+)/:x(\\d+)/:y(\\d+):scale(@\\d+x)?.png`,
        checkReadyMiddleware(),
        getRenderedTileHandler()
      );
    }

    return app;
  },

  add: async () => {
    if (config.options.serveRendered === true) {
      /* Register mlgl events */
      mlgl.on("message", (error) => {
        if (error.severity === "ERROR") {
          printLog("error", `mlgl: ${JSON.stringify(error)}`);
        } else if (error.severity === "WARNING") {
          printLog("warning", `mlgl: ${JSON.stringify(error)}`);
        }
      });

      /* Create empty tiles */
      const emptyDatas = createEmptyData();

      /* Register render callback */
      await Promise.all(
        Object.keys(config.repo.styles).map(async (id) => {
          try {
            const item = config.repo.styles[id];
            const rendered = {
              tileJSON: createMetadata({
                name: item.name,
                description: item.name,
              }),
              renderers: [],
            };

            /* Read style.json file */
            let styleJSON;

            try {
              styleJSON = await getStyle(item.path);
            } catch (error) {
              if (
                item.sourceURL !== undefined &&
                error.message === "Style does not exist"
              ) {
                /* Add to repo */
                config.repo.rendereds[id] = rendered;

                return;
              } else {
                throw error;
              }
            }

            /* Fix center */
            if (styleJSON.center?.length >= 2 && styleJSON.zoom) {
              rendered.tileJSON.center = [
                styleJSON.center[0],
                styleJSON.center[1],
                Math.floor(styleJSON.zoom),
              ];
            }

            await Promise.all(
              // Fix source urls
              Object.keys(styleJSON.sources).map(async (id) => {
                const source = styleJSON.sources[id];

                if (source.tiles !== undefined) {
                  const tiles = new Set(
                    source.tiles.map((tile) => {
                      if (
                        tile.startsWith("pmtiles://") === true ||
                        tile.startsWith("mbtiles://") === true ||
                        tile.startsWith("xyz://") === true
                      ) {
                        const queryIndex = tile.lastIndexOf("?");
                        const sourceID =
                          queryIndex === -1
                            ? tile.split("/")[2]
                            : tile.split("/")[2].slice(0, queryIndex);
                        const sourceData = config.repo.datas[sourceID];

                        tile = `${
                          sourceData.sourceType
                        }://${sourceID}/{z}/{x}/{y}.${
                          sourceData.tileJSON.format
                        }${queryIndex === -1 ? "" : tile.slice(queryIndex)}`;
                      }

                      return tile;
                    })
                  );

                  source.tiles = Array.from(tiles);
                }

                if (source.urls !== undefined) {
                  const otherUrls = [];

                  source.urls.forEach((url) => {
                    if (
                      url.startsWith("pmtiles://") === true ||
                      url.startsWith("mbtiles://") === true ||
                      url.startsWith("xyz://") === true
                    ) {
                      const queryIndex = url.lastIndexOf("?");
                      const sourceID =
                        queryIndex === -1
                          ? url.split("/")[2]
                          : url.split("/")[2].slice(0, queryIndex);
                      const sourceData = config.repo.datas[sourceID];

                      const tile = `${
                        sourceData.sourceType
                      }://${sourceID}/{z}/{x}/{y}.${
                        sourceData.tileJSON.format
                      }${queryIndex === -1 ? "" : url.slice(queryIndex)}`;

                      if (source.tiles !== undefined) {
                        if (source.tiles.includes(tile) === false) {
                          source.tiles.push(tile);
                        }
                      } else {
                        source.tiles = [tile];
                      }
                    } else {
                      if (otherUrls.includes(url) === false) {
                        otherUrls.push(url);
                      }
                    }
                  });

                  if (otherUrls.length === 0) {
                    delete source.urls;
                  } else {
                    source.urls = otherUrls;
                  }
                }

                if (source.url !== undefined) {
                  if (
                    source.url.startsWith("pmtiles://") === true ||
                    source.url.startsWith("mbtiles://") === true ||
                    source.url.startsWith("xyz://") === true
                  ) {
                    const queryIndex = source.url.lastIndexOf("?");
                    const sourceID =
                      queryIndex === -1
                        ? source.url.split("/")[2]
                        : source.url.split("/")[2].slice(0, queryIndex);
                    const sourceData = config.repo.datas[sourceID];

                    const tile = `${
                      sourceData.sourceType
                    }://${sourceID}/{z}/{x}/{y}.${sourceData.tileJSON.format}${
                      queryIndex === -1 ? "" : source.url.slice(queryIndex)
                    }`;

                    if (source.tiles !== undefined) {
                      if (source.tiles.includes(tile) === false) {
                        source.tiles.push(tile);
                      }
                    } else {
                      source.tiles = [tile];
                    }

                    delete source.url;
                  }
                }

                if (
                  source.url === undefined &&
                  source.urls === undefined &&
                  source.tiles !== undefined
                ) {
                  if (source.tiles.length === 1) {
                    if (
                      source.tiles[0].startsWith("pmtiles://") === true ||
                      source.tiles[0].startsWith("mbtiles://") === true ||
                      source.tiles[0].startsWith("xyz://") === true
                    ) {
                      const sourceID = source.tiles[0].split("/")[2];
                      const sourceData = config.repo.datas[sourceID];

                      styleJSON.sources[id] = {
                        ...sourceData.tileJSON,
                        ...source,
                        tiles: [source.tiles[0]],
                      };
                    }
                  }
                }

                // Add atribution
                if (
                  source.attribution &&
                  rendered.tileJSON.attribution.includes(source.attribution) ===
                    false
                ) {
                  rendered.tileJSON.attribution += ` | ${source.attribution}`;
                }
              })
            );

            /* Create pools */
            for (
              let scale = 1;
              scale <= config.options.maxScaleRender;
              scale++
            ) {
              rendered.renderers.push(
                createPool(
                  {
                    create: () => {
                      const renderer = new mlgl.Map({
                        mode: "tile",
                        ratio: scale,
                        request: async (req, callback) => {
                          const url = decodeURIComponent(req.url);
                          const parts = url.split("/");
                          const protocol = parts[0];

                          if (protocol === "sprites:") {
                            try {
                              const data = await getSprite(parts[2], parts[3]);

                              callback(null, {
                                data: data,
                              });
                            } catch (error) {
                              callback(error, {
                                data: null,
                              });
                            }
                          } else if (protocol === "fonts:") {
                            try {
                              let data = await getFonts(parts[2], parts[3]);

                              /* Unzip pbf font */
                              const headers =
                                detectFormatAndHeaders(data).headers;

                              if (
                                headers["Content-Type"] ===
                                  "application/x-protobuf" &&
                                headers["Content-Encoding"] !== undefined
                              ) {
                                zlib.unzip(data, (error, buffer) => {
                                  if (error) {
                                    throw error;
                                  }

                                  data = buffer;
                                });
                              }

                              callback(null, {
                                data: data,
                              });
                            } catch (error) {
                              callback(error, {
                                data: null,
                              });
                            }
                          } else if (
                            protocol === "mbtiles:" ||
                            protocol === "pmtiles:"
                          ) {
                            const sourceID = parts[2];
                            const z = Number(parts[3]);
                            const x = Number(parts[4]);
                            const y = Number(
                              parts[5].slice(0, parts[5].indexOf("."))
                            );
                            const sourceData = config.repo.datas[sourceID];
                            let scheme = "xyz";

                            try {
                              const queryIndex = url.lastIndexOf("?");
                              if (queryIndex !== -1) {
                                const query = new URLSearchParams(
                                  url.slice(queryIndex)
                                );

                                scheme = query.get("scheme");
                                if (!scheme) {
                                  scheme = "xyz";
                                }
                              }

                              /* Get rendered tile */
                              const dataTile =
                                sourceData.sourceType === "mbtiles"
                                  ? await getMBTilesTile(
                                      sourceData.source,
                                      z,
                                      x,
                                      scheme === sourceData.tileJSON.scheme
                                        ? y
                                        : (1 << z) - 1 - y
                                    )
                                  : await getPMTilesTile(
                                      sourceData.source,
                                      z,
                                      x,
                                      scheme === sourceData.tileJSON.scheme
                                        ? y
                                        : (1 << z) - 1 - y
                                    );

                              /* Unzip pbf rendered tile */
                              if (
                                dataTile.headers["Content-Type"] ===
                                  "application/x-protobuf" &&
                                dataTile.headers["Content-Encoding"] !==
                                  undefined
                              ) {
                                zlib.unzip(dataTile.data, (error, buffer) => {
                                  if (error) {
                                    throw error;
                                  }

                                  dataTile.data = buffer;
                                });
                              }

                              callback(null, {
                                data: dataTile.data,
                              });
                            } catch (error) {
                              printLog(
                                "warning",
                                `Failed to get data "${sourceID}" - Tile "${z}/${x}/${y}": ${error}. Serving empty tile...`
                              );

                              callback(null, {
                                data:
                                  emptyDatas[sourceData.tileJSON.format] ||
                                  emptyDatas.other,
                              });
                            }
                          } else if (protocol === "xyz:") {
                            const sourceID = parts[2];
                            const z = Number(parts[3]);
                            const x = Number(parts[4]);
                            const y = Number(
                              parts[5].slice(0, parts[5].indexOf("."))
                            );
                            const tileName = `${z}/${x}/${y}`;
                            const sourceData = config.repo.datas[sourceID];
                            let scheme = "xyz";

                            try {
                              const queryIndex = url.lastIndexOf("?");
                              if (queryIndex !== -1) {
                                const query = new URLSearchParams(
                                  url.slice(queryIndex)
                                );

                                scheme = query.get("scheme");
                              }

                              /* Get rendered tile */
                              let dataTile;

                              try {
                                dataTile = await getXYZTile(
                                  sourceData.source,
                                  z,
                                  x,
                                  scheme === sourceData.tileJSON.scheme
                                    ? y
                                    : (1 << z) - 1 - y,
                                  sourceData.tileJSON.format
                                );
                              } catch (error) {
                                if (
                                  error.message === "Tile does not exist" &&
                                  sourceData.sourceURL !== undefined
                                ) {
                                  const url = sourceData.sourceURL.replaceAll(
                                    "{z}/{x}/{y}",
                                    tileName
                                  );

                                  printLog(
                                    "info",
                                    `Forwarding data "${id}" - Tile "${tileName}" - From "${url}"...`
                                  );

                                  /* Get data */
                                  dataTile = await getXYZTileFromURL(
                                    url,
                                    60000 // 1 mins
                                  );

                                  /* Cache */
                                  if (sourceData.storeCache === true) {
                                    cacheXYZTileDataFile(
                                      sourceData.source,
                                      z,
                                      x,
                                      y,
                                      sourceData.tileJSON.format,
                                      dataTile.data,
                                      dataTile.etag,
                                      sourceData.storeMD5,
                                      sourceData.storeTransparent
                                    );
                                  }
                                } else {
                                  throw error;
                                }
                              }

                              /* Unzip pbf rendered tile */
                              if (
                                dataTile.headers["Content-Type"] ===
                                  "application/x-protobuf" &&
                                dataTile.headers["Content-Encoding"] !==
                                  undefined
                              ) {
                                zlib.unzip(dataTile.data, (error, buffer) => {
                                  if (error) {
                                    throw error;
                                  }

                                  dataTile.data = buffer;
                                });
                              }

                              callback(null, {
                                data: dataTile.data,
                              });
                            } catch (error) {
                              printLog(
                                "warning",
                                `Failed to get data "${sourceID}" - Tile "${tileName}": ${error}. Serving empty tile...`
                              );

                              callback(null, {
                                data:
                                  emptyDatas[sourceData.tileJSON.format] ||
                                  emptyDatas.other,
                              });
                            }
                          } else if (
                            protocol === "http:" ||
                            protocol === "https:"
                          ) {
                            try {
                              printLog(
                                "info",
                                `Getting data tile from "${url}"...`
                              );

                              const dataTile = await getDataFromURL(
                                url,
                                60000 // 1 mins
                              );

                              /* Unzip pbf data */
                              const headers = detectFormatAndHeaders(
                                dataTile.data
                              ).headers;

                              if (
                                headers["Content-Type"] ===
                                  "application/x-protobuf" &&
                                headers["Content-Encoding"] !== undefined
                              ) {
                                zlib.unzip(dataTile.data, (error, buffer) => {
                                  if (error) {
                                    throw error;
                                  }

                                  dataTile.data = buffer;
                                });
                              }

                              callback(null, {
                                data: dataTile.data,
                              });
                            } catch (error) {
                              printLog(
                                "warning",
                                `Failed to get data tile from "${url}": ${error}. Serving empty tile...`
                              );

                              const queryIndex = url.lastIndexOf("?");
                              const format =
                                queryIndex === -1
                                  ? url.slice(url.lastIndexOf(".") + 1)
                                  : url.slice(
                                      url.lastIndexOf(".") + 1,
                                      queryIndex
                                    );

                              callback(null, {
                                data: emptyDatas[format] || emptyDatas.other,
                              });
                            }
                          }
                        },
                      });

                      renderer.load(styleJSON);

                      return renderer;
                    },
                    destroy: (renderer) => renderer.release(),
                  },
                  {
                    min: config.options.minPoolSize,
                    max: config.options.maxPoolSize,
                  }
                )
              );
            }

            /* Add to repo */
            config.repo.rendereds[id] = rendered;
          } catch (error) {
            printLog(
              "error",
              `Failed to load rendered "${id}": ${error}. Skipping...`
            );
          }
        })
      );
    }
  },
};
