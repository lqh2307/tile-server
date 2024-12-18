"use strict";

import { cacheXYZTileDataFile, getXYZTileFromURL, getXYZTile } from "./xyz.js";
import { createEmptyData, renderImage } from "./image.js";
import { checkReadyMiddleware } from "./middleware.js";
import { StatusCodes } from "http-status-codes";
import mlgl from "@maplibre/maplibre-gl-native";
import { getPMTilesTile } from "./pmtiles.js";
import { createPool } from "generic-pool";
import { readSeedFile } from "./seed.js";
import { getSprite } from "./sprite.js";
import { printLog } from "./logger.js";
import { getFonts } from "./font.js";
import { config } from "./config.js";
import express from "express";
import {
  getMBTilesTileFromURL,
  cacheMBtilesTileData,
  getMBTilesTile,
} from "./mbtiles.js";
import {
  detectFormatAndHeaders,
  getDataFromURL,
  getRequestHost,
  createMetadata,
  calculateMD5,
  isExistFile,
  unzipAsync,
} from "./utils.js";
import {
  getStyleJSONFromURL,
  downloadStyleFile,
  cacheStyleFile,
  validateStyle,
  getStyle,
} from "./style.js";

/**
 * Get styleJSON handler
 * @returns {(req: any, res: any, next: any) => Promise<any>}
 */
function getStyleHandler() {
  return async (req, res, next) => {
    const id = req.params.id;
    const item = config.repo.styles[id];

    /* Check style is used? */
    if (item === undefined) {
      return res.status(StatusCodes.NOT_FOUND).send("Style is not found");
    }

    /* Get styleJSON */
    let styleJSON;

    try {
      try {
        styleJSON = await getStyle(item.path);
      } catch (error) {
        if (
          item.sourceURL !== undefined &&
          error.message === "Style does not exist"
        ) {
          printLog(
            "info",
            `Forwarding style "${id}" - To "${item.sourceURL}"...`
          );

          /* Get style */
          styleJSON = await getStyleJSONFromURL(
            item.sourceURL,
            60000 // 1 mins
          );

          /* Cache */
          if (item.storeCache === true) {
            cacheStyleFile(item.path, JSON.stringify(styleJSON, null, 2));
          }
        } else {
          throw error;
        }
      }

      if (req.query.raw !== "true") {
        const requestHost = getRequestHost(req);

        /* Fix sprite url */
        if (styleJSON.sprite !== undefined) {
          if (styleJSON.sprite.startsWith("sprites://") === true) {
            styleJSON.sprite = styleJSON.sprite.replaceAll(
              "sprites://",
              `${requestHost}/sprites/`
            );
          }
        }

        /* Fix fonts url */
        if (styleJSON.glyphs !== undefined) {
          if (styleJSON.glyphs.startsWith("fonts://") === true) {
            styleJSON.glyphs = styleJSON.glyphs.replaceAll(
              "fonts://",
              `${requestHost}/fonts/`
            );
          }
        }

        /* Fix source urls */
        await Promise.all(
          Object.keys(styleJSON.sources).map(async (id) => {
            const source = styleJSON.sources[id];

            // Fix tileJSON URL
            if (source.url !== undefined) {
              if (
                source.url.startsWith("mbtiles://") === true ||
                source.url.startsWith("pmtiles://") === true ||
                source.url.startsWith("xyz://") === true
              ) {
                const sourceID = source.url.split("/")[2];

                source.url = `${requestHost}/datas/${sourceID}.json`;
              }
            }

            // Fix tileJSON URLs
            if (source.urls !== undefined) {
              const urls = new Set(
                source.urls.map((url) => {
                  if (
                    url.startsWith("pmtiles://") === true ||
                    url.startsWith("mbtiles://") === true ||
                    url.startsWith("xyz://") === true
                  ) {
                    const sourceID = url.split("/")[2];

                    url = `${requestHost}/datas/${sourceID}.json`;
                  }

                  return url;
                })
              );

              source.urls = Array.from(urls);
            }

            // Fix tile URL
            if (source.tiles !== undefined) {
              const tiles = new Set(
                source.tiles.map((tile) => {
                  if (
                    tile.startsWith("pmtiles://") === true ||
                    tile.startsWith("mbtiles://") === true ||
                    tile.startsWith("xyz://") === true
                  ) {
                    const sourceID = tile.split("/")[2];
                    const sourceData = config.repo.datas[sourceID];

                    tile = `${requestHost}/datas/${sourceID}/{z}/{x}/{y}.${sourceData.tileJSON.format}`;
                  }

                  return tile;
                })
              );

              source.tiles = Array.from(tiles);
            }
          })
        );
      }

      res.header("content-type", "application/json");

      return res.status(StatusCodes.OK).send(styleJSON);
    } catch (error) {
      printLog("error", `Failed to get style "${id}": ${error}`);

      if (error.message === "Style does not exist") {
        return res.status(StatusCodes.NO_CONTENT).send(error.message);
      }

      return res
        .status(StatusCodes.INTERNAL_SERVER_ERROR)
        .send("Internal server error");
    }
  };
}

/**
 * Get styleJSON MD5 handler
 * @returns {(req: any, res: any, next: any) => Promise<any>}
 */
function getStyleMD5Handler() {
  return async (req, res, next) => {
    const id = req.params.id;
    const item = config.repo.styles[id];

    /* Check style is used? */
    if (item === undefined) {
      return res.status(StatusCodes.NOT_FOUND).send("Style is not found");
    }

    /* Get styleJSON MD5 */
    try {
      const styleJSON = await getStyle(item.path);

      if (req.query.raw !== "true") {
        const requestHost = getRequestHost(req);

        /* Fix sprite url */
        if (styleJSON.sprite !== undefined) {
          if (styleJSON.sprite.startsWith("sprites://") === true) {
            styleJSON.sprite = styleJSON.sprite.replaceAll(
              "sprites://",
              `${requestHost}/sprites/`
            );
          }
        }

        /* Fix fonts url */
        if (styleJSON.glyphs !== undefined) {
          if (styleJSON.glyphs.startsWith("fonts://") === true) {
            styleJSON.glyphs = styleJSON.glyphs.replaceAll(
              "fonts://",
              `${requestHost}/fonts/`
            );
          }
        }

        /* Fix source urls */
        await Promise.all(
          Object.keys(styleJSON.sources).map(async (id) => {
            const source = styleJSON.sources[id];

            // Fix tileJSON URL
            if (source.url !== undefined) {
              if (
                source.url.startsWith("mbtiles://") === true ||
                source.url.startsWith("pmtiles://") === true ||
                source.url.startsWith("xyz://") === true
              ) {
                const sourceID = source.url.split("/")[2];

                source.url = `${requestHost}/datas/${sourceID}.json`;
              }
            }

            // Fix tileJSON URLs
            if (source.urls !== undefined) {
              const urls = new Set(
                source.urls.map((url) => {
                  if (
                    url.startsWith("pmtiles://") === true ||
                    url.startsWith("mbtiles://") === true ||
                    url.startsWith("xyz://") === true
                  ) {
                    const sourceID = url.split("/")[2];

                    url = `${requestHost}/datas/${sourceID}.json`;
                  }

                  return url;
                })
              );

              source.urls = Array.from(urls);
            }

            // Fix tile URL
            if (source.tiles !== undefined) {
              const tiles = new Set(
                source.tiles.map((tile) => {
                  if (
                    tile.startsWith("pmtiles://") === true ||
                    tile.startsWith("mbtiles://") === true ||
                    tile.startsWith("xyz://") === true
                  ) {
                    const sourceID = tile.split("/")[2];
                    const sourceData = config.repo.datas[sourceID];

                    tile = `${requestHost}/datas/${sourceID}/{z}/{x}/{y}.${sourceData.tileJSON.format}`;
                  }

                  return tile;
                })
              );

              source.tiles = Array.from(tiles);
            }
          })
        );
      }

      /* Add MD5 to header */
      res.set({
        etag: calculateMD5(Buffer.from(JSON.stringify(styleJSON), "utf8")),
      });

      return res.status(StatusCodes.OK).send();
    } catch (error) {
      printLog("error", `Failed to get md5 style "${id}": ${error}`);

      if (error.message === "Style does not exist") {
        return res.status(StatusCodes.NO_CONTENT).send(error.message);
      }

      return res
        .status(StatusCodes.INTERNAL_SERVER_ERROR)
        .send("Internal server error");
    }
  };
}

/**
 * Get style list handler
 * @returns {(req: any, res: any, next: any) => Promise<any>}
 */
function getStylesListHandler() {
  return async (req, res, next) => {
    try {
      const requestHost = getRequestHost(req);

      const result = await Promise.all(
        Object.keys(config.repo.styles).map(async (id) => {
          return {
            id: id,
            name: config.repo.styles[id].name,
            url: `${requestHost}/styles/${id}/style.json`,
          };
        })
      );

      return res.status(StatusCodes.OK).send(result);
    } catch (error) {
      printLog("error", `Failed to get styles": ${error}`);

      return res
        .status(StatusCodes.INTERNAL_SERVER_ERROR)
        .send("Internal server error");
    }
  };
}

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
      const image = await renderImage(
        item,
        scale,
        tileSize,
        config.options.renderedCompression,
        z,
        x,
        y
      );

      res.header("content-type", `image/png`);

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
      res.header("content-type", "application/json");

      return res.status(StatusCodes.OK).send({
        ...item.tileJSON,
        tilejson: "2.2.0",
        scheme: "xyz",
        id: id,
        tiles: [
          req.params.tileSize === undefined
            ? `${getRequestHost(req)}/styles/${id}/{z}/{x}/{y}.png`
            : `${getRequestHost(req)}/styles/${id}/${
                req.params.tileSize
              }/{z}/{x}/{y}.png`,
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
      const requestHost = getRequestHost(req);

      const result = await Promise.all(
        Object.keys(config.repo.rendereds).map(async (id) => {
          return {
            id: id,
            name: config.repo.rendereds[id].tileJSON.name,
            url: [
              `${requestHost}/styles/256/${id}.json`,
              `${requestHost}/styles/512/${id}.json`,
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
 * Get styleJSON list handler
 * @returns {(req: any, res: any, next: any) => Promise<any>}
 */
function getStyleJSONsListHandler() {
  return async (req, res, next) => {
    try {
      const requestHost = getRequestHost(req);

      const result = await Promise.all(
        Object.keys(config.repo.styles).map(async (id) => {
          const item = config.repo.styles[id];

          /* Get styleJSON */
          let styleJSON;

          try {
            styleJSON = await getStyle(item.path);
          } catch (error) {
            if (
              item.sourceURL !== undefined &&
              error.message === "Style does not exist"
            ) {
              printLog(
                "info",
                `Forwarding style "${id}" - To "${item.sourceURL}"...`
              );

              /* Get style */
              styleJSON = await getStyleJSONFromURL(
                item.sourceURL,
                60000 // 1 mins
              );

              /* Cache */
              if (item.storeCache === true) {
                cacheStyleFile(item.path, JSON.stringify(styleJSON, null, 2));
              }
            } else {
              throw error;
            }
          }

          if (req.query.raw !== "true") {
            /* Fix sprite url */
            if (styleJSON.sprite !== undefined) {
              if (styleJSON.sprite.startsWith("sprites://") === true) {
                styleJSON.sprite = styleJSON.sprite.replaceAll(
                  "sprites://",
                  `${requestHost}/sprites/`
                );
              }
            }

            /* Fix fonts url */
            if (styleJSON.glyphs !== undefined) {
              if (styleJSON.glyphs.startsWith("fonts://") === true) {
                styleJSON.glyphs = styleJSON.glyphs.replaceAll(
                  "fonts://",
                  `${requestHost}/fonts/`
                );
              }
            }

            /* Fix source urls */
            await Promise.all(
              Object.keys(styleJSON.sources).map(async (id) => {
                const source = styleJSON.sources[id];

                // Fix tileJSON URL
                if (source.url !== undefined) {
                  if (
                    source.url.startsWith("mbtiles://") === true ||
                    source.url.startsWith("pmtiles://") === true ||
                    source.url.startsWith("xyz://") === true
                  ) {
                    const sourceID = source.url.split("/")[2];

                    source.url = `${requestHost}/datas/${sourceID}.json`;
                  }
                }

                // Fix tileJSON URLs
                if (source.urls !== undefined) {
                  const urls = new Set(
                    source.urls.map((url) => {
                      if (
                        url.startsWith("pmtiles://") === true ||
                        url.startsWith("mbtiles://") === true ||
                        url.startsWith("xyz://") === true
                      ) {
                        const sourceID = url.split("/")[2];

                        url = `${requestHost}/datas/${sourceID}.json`;
                      }

                      return url;
                    })
                  );

                  source.urls = Array.from(urls);
                }

                // Fix tile URL
                if (source.tiles !== undefined) {
                  const tiles = new Set(
                    source.tiles.map((tile) => {
                      if (
                        tile.startsWith("pmtiles://") === true ||
                        tile.startsWith("mbtiles://") === true ||
                        tile.startsWith("xyz://") === true
                      ) {
                        const sourceID = tile.split("/")[2];
                        const sourceData = config.repo.datas[sourceID];

                        tile = `${requestHost}/datas/${sourceID}/{z}/{x}/{y}.${sourceData.tileJSON.format}`;
                      }

                      return tile;
                    })
                  );

                  source.tiles = Array.from(tiles);
                }
              })
            );
          }

          return styleJSON;
        })
      );

      return res.status(StatusCodes.OK).send(result);
    } catch (error) {
      printLog("error", `Failed to get styleJSONs": ${error}`);

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
      const requestHost = getRequestHost(req);

      const result = await Promise.all(
        Object.keys(config.repo.rendereds).map(async (id) => {
          return {
            ...config.repo.rendereds[id].tileJSON,
            id: id,
            tilejson: "2.2.0",
            scheme: "xyz",
            tiles: [`${requestHost}/styles/${id}/{z}/{x}/{y}.png`],
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

export const serve_style = {
  init: () => {
    const app = express().disable("x-powered-by");

    /**
     * @swagger
     * tags:
     *   - name: Style
     *     description: Style related endpoints
     * /styles/styles.json:
     *   get:
     *     tags:
     *       - Style
     *     summary: Get all styles
     *     responses:
     *       200:
     *         description: List of all styles
     *         content:
     *           application/json:
     *             schema:
     *               type: array
     *               items:
     *                 type: object
     *                 properties:
     *                   id:
     *                     type: string
     *                   name:
     *                     type: string
     *                   url:
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
    app.get("/styles.json", checkReadyMiddleware(), getStylesListHandler());

    /**
     * @swagger
     * tags:
     *   - name: Style
     *     description: Style related endpoints
     * /styles/stylejsons.json:
     *   get:
     *     tags:
     *       - Style
     *     summary: Get all styleJSONs
     *     parameters:
     *       - in: query
     *         name: raw
     *         schema:
     *           type: boolean
     *         required: false
     *         description: Use raw
     *     responses:
     *       200:
     *         description: List of all styleJSONs
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
      "/stylejsons.json",
      checkReadyMiddleware(),
      getStyleJSONsListHandler()
    );

    /**
     * @swagger
     * tags:
     *   - name: Style
     *     description: Style related endpoints
     * /styles/{id}/style.json:
     *   get:
     *     tags:
     *       - Style
     *     summary: Get styleJSON
     *     parameters:
     *       - in: path
     *         name: id
     *         schema:
     *           type: string
     *           example: id
     *         required: true
     *         description: ID of the style
     *       - in: query
     *         name: raw
     *         schema:
     *           type: boolean
     *         required: false
     *         description: Use raw
     *     responses:
     *       200:
     *         description: StyleJSON
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
    app.get("/:id/style.json", checkReadyMiddleware(), getStyleHandler());

    /**
     * @swagger
     * tags:
     *   - name: Style
     *     description: Style related endpoints
     * /styles/{id}/md5/style.json:
     *   get:
     *     tags:
     *       - Style
     *     summary: Get styleJSON MD5
     *     parameters:
     *       - in: path
     *         name: id
     *         schema:
     *           type: string
     *           example: id
     *         required: true
     *         description: ID of the style
     *       - in: query
     *         name: raw
     *         schema:
     *           type: boolean
     *         required: false
     *         description: Use raw
     *     responses:
     *       200:
     *         description: StyleJSON MD5
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
      "/:id/md5/style.json",
      checkReadyMiddleware(),
      getStyleMD5Handler()
    );

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
       *           example: 256
       *         required: false
       *         description: Tile size (256 or 512)
       *       - in: path
       *         name: id
       *         schema:
       *           type: string
       *           example: id
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
       *           example: id
       *         required: true
       *         description: ID of the style
       *       - in: path
       *         name: tileSize
       *         schema:
       *           type: integer
       *           enum: [256, 512]
       *           example: 256
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
    const seed = await readSeedFile(true);

    /* Create empty tiles */
    const emptyDatas =
      config.options.serveRendered === true ? createEmptyData() : {};

    await Promise.all(
      Object.keys(config.styles).map(async (id) => {
        const item = config.styles[id];
        let serveRendered = false;
        const styleInfo = {};
        let styleJSON;

        /* Serve style */
        try {
          if (
            item.style.startsWith("https://") === true ||
            item.style.startsWith("http://") === true
          ) {
            styleInfo.path = `${process.env.DATA_DIR}/styles/${id}/style.json`;

            /* Download style.json file */
            if ((await isExistFile(styleInfo.path)) === false) {
              await downloadStyleFile(
                item.style,
                styleInfo.path,
                5,
                300000 // 5 mins
              );
            }
          } else {
            if (item.cache !== undefined) {
              styleInfo.path = `${process.env.DATA_DIR}/caches/styles/${item.style}/style.json`;

              const cacheSource = seed.styles[item.style];

              if (cacheSource === undefined) {
                throw new Error(`Cache style "${item.style}" is invalid`);
              }

              if (item.cache.forward === true) {
                styleInfo.sourceURL = cacheSource.url;
                styleInfo.storeCache = item.cache.store;
              }
            } else {
              styleInfo.path = `${process.env.DATA_DIR}/styles/${item.style}`;
            }
          }

          try {
            /* Read style.json file */
            styleJSON = await getStyle(styleInfo.path);

            /* Validate style */
            await validateStyle(styleJSON);

            /* Store style info */
            styleInfo.name = styleJSON.name || "Unknown";
            styleInfo.zoom = styleJSON.zoom || 0;
            styleInfo.center = styleJSON.center || [0, 0, 0];

            /* Mark to serve rendered */
            serveRendered = config.options.serveRendered;
          } catch (error) {
            if (
              item.cache !== undefined &&
              error.message === "Style does not exist"
            ) {
              styleInfo.name =
                seed.styles[item.style].metadata.name || "Unknown";
              styleInfo.zoom = seed.styles[item.style].metadata.zoom || 0;
              styleInfo.center = seed.styles[item.style].metadata.center || [
                0, 0, 0,
              ];

              /* Mark to serve rendered */
              serveRendered = false;
            } else {
              throw error;
            }
          }

          /* Add to repo */
          config.repo.styles[id] = styleInfo;
        } catch (error) {
          printLog(
            "error",
            `Failed to load style "${id}": ${error}. Skipping...`
          );
        }

        /* Serve rendered */
        if (serveRendered === true) {
          try {
            /* Rendered info */
            const rendered = {
              tileJSON: createMetadata({
                name: styleInfo.name,
                description: styleInfo.name,
              }),
            };

            /* Fix center */
            if (styleJSON.center?.length >= 2 && styleJSON.zoom) {
              rendered.tileJSON.center = [
                styleJSON.center[0],
                styleJSON.center[1],
                Math.floor(styleJSON.zoom),
              ];
            }

            /* Fix sources */
            await Promise.all(
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
                        const sourceID = tile.split("/")[2];
                        const sourceData = config.repo.datas[sourceID];

                        tile = `${sourceData.sourceType}://${sourceID}/{z}/{x}/{y}.${sourceData.tileJSON.format}`;
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
                      const sourceID = url.split("/")[2];
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
                    source.url.startsWith("mbtiles://") === true ||
                    source.url.startsWith("xyz://") === true
                  ) {
                    const sourceID = source.url.split("/")[2];
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
            rendered.renderers = Array.from(
              {
                length: config.options.maxScaleRender,
              },
              (_, index) => {
                return createPool(
                  {
                    create: () => {
                      const renderer = new mlgl.Map({
                        mode: "tile",
                        ratio: index + 1,
                        request: async (req, callback) => {
                          const url = decodeURIComponent(req.url);
                          const parts = url.split("/");

                          if (parts[0] === "sprites:") {
                            try {
                              /* Get sprite */
                              const data = await getSprite(parts[2], parts[3]);

                              callback(null, {
                                data: data,
                              });
                            } catch (error) {
                              printLog(
                                "warning",
                                `Failed to get sprite "${parts[2]}" - File "${parts[3]}": ${error}. Serving empty sprite...`
                              );

                              callback(error, {
                                data: null,
                              });
                            }
                          } else if (parts[0] === "fonts:") {
                            try {
                              /* Get font */
                              let data = await getFonts(parts[2], parts[3]);

                              /* Unzip pbf font */
                              const headers =
                                detectFormatAndHeaders(data).headers;

                              if (
                                headers["content-type"] ===
                                  "application/x-protobuf" &&
                                headers["content-encoding"] !== undefined
                              ) {
                                data = await unzipAsync(data);
                              }

                              callback(null, {
                                data: data,
                              });
                            } catch (error) {
                              printLog(
                                "warning",
                                `Failed to get font "${parts[2]}" - File "${parts[3]}": ${error}. Serving empty font...`
                              );

                              callback(error, {
                                data: null,
                              });
                            }
                          } else if (parts[0] === "pmtiles:") {
                            const z = Number(parts[3]);
                            const x = Number(parts[4]);
                            const y = Number(
                              parts[5].slice(0, parts[5].indexOf("."))
                            );
                            const tileName = `${z}/${x}/${y}`;
                            const sourceData = config.repo.datas[parts[2]];

                            try {
                              /* Get rendered tile */
                              const dataTile = await getPMTilesTile(
                                sourceData.source,
                                z,
                                x,
                                y
                              );

                              /* Unzip pbf rendered tile */
                              if (
                                dataTile.headers["content-type"] ===
                                  "application/x-protobuf" &&
                                dataTile.headers["content-encoding"] !==
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
                                `Failed to get data "${parts[2]}" - Tile "${tileName}": ${error}. Serving empty tile...`
                              );

                              callback(null, {
                                data:
                                  emptyDatas[sourceData.tileJSON.format] ||
                                  emptyDatas.other,
                              });
                            }
                          } else if (parts[0] === "mbtiles:") {
                            const z = Number(parts[3]);
                            const x = Number(parts[4]);
                            const y = Number(
                              parts[5].slice(0, parts[5].indexOf("."))
                            );
                            const tileName = `${z}/${x}/${y}`;
                            const sourceData = config.repo.datas[parts[2]];

                            try {
                              /* Get rendered tile */
                              let dataTile;

                              try {
                                dataTile = await getMBTilesTile(
                                  sourceData.source,
                                  z,
                                  x,
                                  y
                                );
                              } catch (error) {
                                if (
                                  sourceData.sourceURL !== undefined &&
                                  error.message === "Tile does not exist"
                                ) {
                                  const url = sourceData.sourceURL.replaceAll(
                                    "{z}/{x}/{y}",
                                    tileName
                                  );

                                  printLog(
                                    "info",
                                    `Forwarding data "${id}" - Tile "${tileName}" - To "${url}"...`
                                  );

                                  /* Get data */
                                  dataTile = await getMBTilesTileFromURL(
                                    url,
                                    60000 // 1 mins
                                  );

                                  /* Cache */
                                  if (sourceData.storeCache === true) {
                                    cacheMBtilesTileData(
                                      sourceData.source,
                                      z,
                                      x,
                                      y,
                                      dataTile.data,
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
                                dataTile.headers["content-type"] ===
                                  "application/x-protobuf" &&
                                dataTile.headers["content-encoding"] !==
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
                                `Failed to get data "${parts[2]}" - Tile "${tileName}": ${error}. Serving empty tile...`
                              );

                              callback(null, {
                                data:
                                  emptyDatas[sourceData.tileJSON.format] ||
                                  emptyDatas.other,
                              });
                            }
                          } else if (parts[0] === "xyz:") {
                            const z = Number(parts[3]);
                            const x = Number(parts[4]);
                            const y = Number(
                              parts[5].slice(0, parts[5].indexOf("."))
                            );
                            const tileName = `${z}/${x}/${y}`;
                            const sourceData = config.repo.datas[parts[2]];

                            try {
                              /* Get rendered tile */
                              let dataTile;

                              try {
                                dataTile = await getXYZTile(
                                  sourceData.source,
                                  z,
                                  x,
                                  y,
                                  sourceData.tileJSON.format
                                );
                              } catch (error) {
                                if (
                                  sourceData.sourceURL !== undefined &&
                                  error.message === "Tile does not exist"
                                ) {
                                  const url = sourceData.sourceURL.replaceAll(
                                    "{z}/{x}/{y}",
                                    tileName
                                  );

                                  printLog(
                                    "info",
                                    `Forwarding data "${id}" - Tile "${tileName}" - To "${url}"...`
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
                                      sourceData.md5Source,
                                      z,
                                      x,
                                      y,
                                      sourceData.tileJSON.format,
                                      dataTile.data,
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
                                dataTile.headers["content-type"] ===
                                  "application/x-protobuf" &&
                                dataTile.headers["content-encoding"] !==
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
                                `Failed to get data "${parts[2]}" - Tile "${tileName}": ${error}. Serving empty tile...`
                              );

                              callback(null, {
                                data:
                                  emptyDatas[sourceData.tileJSON.format] ||
                                  emptyDatas.other,
                              });
                            }
                          } else if (
                            parts[0] === "http:" ||
                            parts[0] === "https:"
                          ) {
                            try {
                              printLog(
                                "info",
                                `Getting data tile from "${url}"...`
                              );

                              const dataTile = await getDataFromURL(
                                url,
                                60000, // 1 mins,
                                "arraybuffer"
                              );

                              /* Unzip pbf data */
                              const headers = detectFormatAndHeaders(
                                dataTile.data
                              ).headers;

                              if (
                                headers["content-type"] ===
                                  "application/x-protobuf" &&
                                headers["content-encoding"] !== undefined
                              ) {
                                dataTile.data = await unzipAsync(dataTile.data);
                              }

                              callback(null, {
                                data: dataTile.data,
                              });
                            } catch (error) {
                              printLog(
                                "warning",
                                `Failed to get data tile from "${url}": ${error}. Serving empty tile...`
                              );

                              callback(null, {
                                data:
                                  emptyDatas[
                                    url.slice(url.lastIndexOf(".") + 1)
                                  ] || emptyDatas.other,
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
                    min: config.options.minRenderedPoolSize,
                    max: config.options.maxRenderedPoolSize,
                  }
                );
              }
            );

            /* Add to repo */
            config.repo.rendereds[id] = rendered;
          } catch (error) {
            printLog(
              "error",
              `Failed to load rendered "${id}": ${error}. Skipping...`
            );
          }
        }
      })
    );
  },
};
