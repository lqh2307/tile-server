"use strict";

import mlgl from "@maplibre/maplibre-gl-native";
import { StatusCodes } from "http-status-codes";
import { createPool } from "generic-pool";
import fs from "node:fs/promises";
import express from "express";
import path from "node:path";
import axios from "axios";
import sharp from "sharp";
import {
  detectFormatAndHeaders,
  createNewXYZTileJSON,
  responseEmptyTile,
  getRequestHost,
  getPMTilesTile,
  getMBTilesTile,
  getFontsPBF,
  unzipAsync,
  printLog,
  mercator,
} from "./utils.js";

function getRenderedTileHandler(config) {
  return async (req, res, next) => {
    const id = decodeURI(req.params.id);
    const item = config.repo.rendereds[id];

    /* Check rendered is exist? */
    if (item === undefined) {
      return res.status(StatusCodes.NOT_FOUND).send("Rendered is not found");
    }

    /* Check rendered tile scale */
    const scale = Number(req.params.scale?.slice(1, -1)) || 1; // Default tile scale is 1

    if (scale > config.options.maxScaleRender) {
      return res
        .status(StatusCodes.BAD_REQUEST)
        .send("Rendered tile scale is invalid");
    }

    const z = Number(req.params.z);
    const x = Number(req.params.x);
    const y = Number(req.params.y);
    const tileSize = Number(req.params.tileSize) || 256; // Default tile size is 256px x 256px

    // For 512px tiles, use the actual maplibre-native zoom. For 256px tiles, use zoom - 1
    const params = {
      zoom: tileSize === 512 ? z : Math.max(0, z - 1),
      center: mercator.ll(
        [
          ((x + 0.5) / (1 << z)) * (256 << z),
          ((y + 0.5) / (1 << z)) * (256 << z),
        ],
        z
      ),
      width: tileSize,
      height: tileSize,
    };

    // HACK1 256px tiles are a zoom level lower than maplibre-native default tiles.
    // This hack allows tile-server to support zoom 0 256px tiles, which would actually be zoom -1 in maplibre-native.
    // Since zoom -1 isn't supported, a double sized zoom 0 tile is requested and resized in HACK2.
    if (z === 0 && tileSize === 256) {
      params.width = 512;
      params.height = 512;
    }
    // END HACK1

    try {
      const renderer = await item.renderers[scale - 1].acquire();

      renderer.render(params, async (error, data) => {
        try {
          item.renderers[scale - 1].release(renderer);

          if (error) {
            throw error;
          }

          const image = sharp(data, {
            raw: {
              premultiplied: true,
              width: params.width * scale,
              height: params.height * scale,
              channels: 4,
            },
          });

          // HACK2 256px tiles are a zoom level lower than maplibre-native default tiles.
          // This hack allows tile-server to support zoom 0 256px tiles, which would actually be zoom -1 in maplibre-native.
          // Since zoom -1 isn't supported, a double sized zoom 0 tile is requested and resized here.
          if (z === 0 && tileSize === 256) {
            image.resize({
              width: 256 * scale,
              height: 256 * scale,
            });
          }
          // END HACK2

          const buffer = await image
            .png({
              compressionLevel: config.options.renderedCompression,
            })
            .toBuffer();

          res.header("Content-Type", `image/png`);

          return res.status(StatusCodes.OK).send(buffer);
        } catch (error) {
          printLog(
            "error",
            `Failed to get rendered "${id}" - Tile ${z}/${x}/${y}: ${error}`
          );

          return res
            .status(StatusCodes.INTERNAL_SERVER_ERROR)
            .send("Internal server error");
        }
      });
    } catch (error) {
      printLog(
        "error",
        `Failed to get rendered "${id}" - Tile ${z}/${x}/${y}: ${error}`
      );

      return res
        .status(StatusCodes.INTERNAL_SERVER_ERROR)
        .send("Internal server error");
    }
  };
}

function getRenderedHandler(config) {
  return async (req, res, next) => {
    const id = decodeURI(req.params.id);
    const item = config.repo.rendereds[id];

    if (item === undefined) {
      return res.status(StatusCodes.NOT_FOUND).send("Rendered is not found");
    }

    try {
      const renderedInfo = {
        ...item.tileJSON,
        tiles: [
          `${getRequestHost(req)}styles/${id}/${
            req.params.tileSize || 256
          }/{z}/{x}/{y}.png`,
        ],
      };

      res.header("Content-Type", "application/json");

      return res.status(StatusCodes.OK).send(renderedInfo);
    } catch (error) {
      printLog("error", `Failed to get rendered "${id}": ${error}`);

      return res
        .status(StatusCodes.INTERNAL_SERVER_ERROR)
        .send("Internal server error");
    }
  };
}

function getRenderedsListHandler(config) {
  return async (req, res, next) => {
    try {
      const rendereds = config.repo.rendereds;

      const result = Object.keys(rendereds).map((id) => {
        return {
          id: id,
          name: rendereds[id].tileJSON.name,
          url: [
            `${getRequestHost(req)}styles/256/${id}.json`,
            `${getRequestHost(req)}styles/512/${id}.json`,
          ],
        };
      });

      return res.status(StatusCodes.OK).send(result);
    } catch (error) {
      printLog("error", `Failed to get rendereds": ${error}`);

      return res
        .status(StatusCodes.INTERNAL_SERVER_ERROR)
        .send("Internal server error");
    }
  };
}

export const serve_rendered = {
  init: (config) => {
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
       */
      app.get("/rendereds.json", getRenderedsListHandler(config));

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
       *         required: true
       *         description: Tile size (256 or 512)
       *       - in: path
       *         name: id
       *         schema:
       *           type: string
       *         required: true
       *         description: ID of the style rendered
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
       *         description: Rendered not found
       *       500:
       *         description: Internal server error
       */
      app.get("/(:tileSize(256|512)/)?:id.json", getRenderedHandler(config));

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
       *         required: true
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
       *     responses:
       *       200:
       *         description: Style tile
       *         content:
       *           image/png:
       *             schema:
       *               type: string
       *               format: binary
       *       404:
       *         description: Rendered not found
       *       500:
       *         description: Internal server error
       */
      app.get(
        `/:id/(:tileSize(256|512)/)?:z(\\d+)/:x(\\d+)/:y(\\d+):scale(@\\d+x)?.png`,
        getRenderedTileHandler(config)
      );
    }

    return app;
  },

  add: async (config) => {
    if (config.options.serveRendered === true) {
      mlgl.on("message", (error) => {
        if (error.severity === "ERROR") {
          printLog("error", `mlgl: ${JSON.stringify(error)}`);
        } else if (error.severity === "WARNING") {
          printLog("warning", `mlgl: ${JSON.stringify(error)}`);
        }
      });
    }

    await Promise.all(
      Object.keys(config.repo.styles).map(async (id) => {
        try {
          const item = config.repo.styles[id];
          const rendered = {
            tileJSON: createNewXYZTileJSON({
              name: item.styleJSON.name,
              description: item.styleJSON.name,
            }),
          };

          /* Fix center */
          if (item.styleJSON.center?.length >= 2 && item.styleJSON.zoom) {
            rendered.tileJSON.center = [
              item.styleJSON.center[0],
              item.styleJSON.center[1],
              Math.floor(item.styleJSON.zoom),
            ];
          }

          /* Fix source urls & Add attribution & Create pools */
          if (config.options.serveRendered === true) {
            /* Clone style JSON */
            const stringJSON = JSON.stringify(item.styleJSON);
            const styleJSON = JSON.parse(stringJSON);

            await Promise.all(
              // Fix source urls
              Object.keys(styleJSON.sources).map(async (id) => {
                const source = styleJSON.sources[id];

                if (source.tiles !== undefined) {
                  const tiles = source.tiles.map((tile) => {
                    if (
                      tile.startsWith("pmtiles://") === true ||
                      tile.startsWith("mbtiles://") === true
                    ) {
                      const sourceID = tile.slice(10);
                      const sourceData = config.repo.datas[sourceID];

                      tile = `${sourceData.sourceType}://${sourceID}/{z}/{x}/{y}.${sourceData.tileJSON.format}`;
                    }

                    return tile;
                  });

                  source.tiles = [...new Set(tiles)];
                }

                if (source.urls !== undefined) {
                  const otherUrls = [];

                  source.urls.forEach((url) => {
                    if (
                      url.startsWith("pmtiles://") === true ||
                      url.startsWith("mbtiles://") === true
                    ) {
                      const sourceID = url.slice(10);
                      const sourceData = config.repo.datas[sourceID];
                      const tile = `${sourceData.sourceType}://${sourceID}/{z}/{x}/{y}.${sourceData.tileJSON.format}`;

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
                    source.url.startsWith("mbtiles://") === true
                  ) {
                    const sourceID = source.url.slice(10);
                    const sourceData = config.repo.datas[sourceID];
                    const tile = `${sourceData.sourceType}://${sourceID}/{z}/{x}/{y}.${sourceData.tileJSON.format}`;

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
                    const tileURL = source.tiles[0];
                    if (
                      tileURL.startsWith("pmtiles://") === true ||
                      tileURL.startsWith("mbtiles://") === true
                    ) {
                      const sourceID = tileURL.split("/")[2];
                      const sourceData = config.repo.datas[sourceID];

                      styleJSON.sources[id] = {
                        ...sourceData.tileJSON,
                        ...source,
                        tiles: [tileURL],
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

            // Create pools
            rendered.renderers = Array.from(
              {
                length: config.options.maxScaleRender,
              },
              (_, scale) =>
                createPool(
                  {
                    create: async () => {
                      const renderer = new mlgl.Map({
                        mode: "tile",
                        ratio: scale + 1,
                        request: async (req, callback) => {
                          const url = decodeURIComponent(req.url);
                          const parts = url.split("/");
                          const protocol = parts[0];

                          if (protocol === "sprites:") {
                            const spriteDir = parts[2];
                            const spriteFile = parts[3];

                            try {
                              const data = await fs.readFile(
                                path.join(
                                  config.options.paths.sprites,
                                  spriteDir,
                                  spriteFile
                                )
                              );

                              callback(null, {
                                data: data,
                              });
                            } catch (error) {
                              callback(error, {
                                data: null,
                              });
                            }
                          } else if (protocol === "fonts:") {
                            const fonts = parts[2];
                            const range = parts[3].split(".")[0];

                            try {
                              let data = await getFontsPBF(
                                config,
                                fonts,
                                range
                              );

                              /* Unzip pbf font */
                              const headers =
                                detectFormatAndHeaders(data).headers;
                              if (headers["Content-Encoding"] !== undefined) {
                                data = await unzipAsync(data);
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
                            const y = Number(parts[5].split(".")[0]);
                            const sourceData = config.repo.datas[sourceID];

                            let dataTile;

                            try {
                              /* Get rendered tile */
                              if (sourceData.sourceType === "mbtiles") {
                                dataTile = await getMBTilesTile(
                                  sourceData.source,
                                  z,
                                  x,
                                  y
                                );
                              } else {
                                dataTile = await getPMTilesTile(
                                  sourceData.source,
                                  z,
                                  x,
                                  y
                                );
                              }

                              /* Unzip pbf rendered tile */
                              if (
                                dataTile.headers["Content-Type"] ===
                                  "application/x-protobuf" &&
                                dataTile.headers["Content-Encoding"] !==
                                  undefined
                              ) {
                                dataTile.data = await unzipAsync(dataTile.data);
                              }

                              callback(null, {
                                data: dataTile.data,
                              });
                            } catch (error) {
                              printLog(
                                "warning",
                                `Failed to get data "${sourceID}" - Tile ${z}/${x}/${y}: ${error}. Serving empty tile...`
                              );

                              responseEmptyTile(
                                sourceData.tileJSON.format,
                                callback
                              );
                            }
                          } else if (
                            protocol === "http:" ||
                            protocol === "https:"
                          ) {
                            try {
                              const { data } = await axios.get(url, {
                                responseType: "arraybuffer",
                              });

                              callback(null, {
                                data: data,
                              });
                            } catch (error) {
                              printLog("warning", error);

                              responseEmptyTile(
                                url.slice(url.lastIndexOf(".") + 1),
                                callback
                              );
                            }
                          }
                        },
                      });

                      renderer.load(styleJSON);

                      return renderer;
                    },
                    destroy: (renderer) => {
                      renderer.release();
                    },
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
  },
};
