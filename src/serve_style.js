"use strict";

import { checkReadyMiddleware } from "./middleware.js";
import { StatusCodes } from "http-status-codes";
import { readSeedFile } from "./seed.js";
import { printLog } from "./logger.js";
import { config } from "./config.js";
import express from "express";
import {
  isLocalTileURL,
  getRequestHost,
  createMetadata,
  calculateMD5,
  isExistFile,
} from "./utils.js";
import {
  getStyleJSONFromURL,
  downloadStyleFile,
  cacheStyleFile,
  validateStyle,
  getStyle,
} from "./style.js";
import {
  renderPostgreSQLTiles,
  renderMBTilesTiles,
  renderXYZTiles,
  renderImage,
} from "./image.js";

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
      return res.status(StatusCodes.NOT_FOUND).send("Style does not exist");
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
            printLog("info", `Caching style "${id}" - File "${filePath}"...`);

            cacheStyleFile(item.path, JSON.stringify(styleJSON, null, 2)).catch(
              (error) =>
                printLog(
                  "error",
                  `Failed to cache style "${id}" - File "${filePath}": ${error}`
                )
            );
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
              if (isLocalTileURL(source.url) === true) {
                const sourceID = source.url.split("/")[2];

                source.url = `${requestHost}/datas/${sourceID}.json`;
              }
            }

            // Fix tileJSON URLs
            if (source.urls !== undefined) {
              const urls = new Set(
                source.urls.map((url) => {
                  if (isLocalTileURL(url) === true) {
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
                  if (isLocalTileURL(tile) === true) {
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
      } else {
        return res
          .status(StatusCodes.INTERNAL_SERVER_ERROR)
          .send("Internal server error");
      }
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
      return res.status(StatusCodes.NOT_FOUND).send("Style does not exist");
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
              if (isLocalTileURL(source.url) === true) {
                const sourceID = source.url.split("/")[2];

                source.url = `${requestHost}/datas/${sourceID}.json`;
              }
            }

            // Fix tileJSON URLs
            if (source.urls !== undefined) {
              const urls = new Set(
                source.urls.map((url) => {
                  if (isLocalTileURL(url) === true) {
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
                  if (isLocalTileURL(tile) === true) {
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
      } else {
        return res
          .status(StatusCodes.INTERNAL_SERVER_ERROR)
          .send("Internal server error");
      }
    }
  };
}

/**
 * Render style handler
 * @returns {(req: any, res: any, next: any) => Promise<any>}
 */
function renderStyleHandler() {
  return async (req, res, next) => {
    const id = req.params.id;
    const item = config.repo.styles[id];

    /* Check rendered is exist? */
    if (item === undefined || item.rendered === undefined) {
      return res.status(StatusCodes.NOT_FOUND).send("Rendered does not exist");
    }

    /* Render style */
    if (item.rendered.export === true) {
      printLog("warning", "A render is already running. Skipping render...");

      return res.status(StatusCodes.OK).send("OK");
    } else {
      try {
        const parsedOptions = JSON.parse(req.query.options);

        setTimeout(() => {
          item.rendered.export = true;

          if (parsedOptions.storeType === "xyz") {
            renderXYZTiles(
              id,
              parsedOptions.metadata,
              parsedOptions.tileScale,
              parsedOptions.tileSize,
              parsedOptions.bbox,
              parsedOptions.maxzoom,
              parsedOptions.concurrency,
              parsedOptions.storeMD5,
              parsedOptions.storeTransparent,
              parsedOptions.createOverview,
              parsedOptions.refreshBefore?.time ||
                parsedOptions.refreshBefore?.day ||
                parsedOptions.refreshBefore?.md5
            ).finally(() => {
              item.rendered.export = false;
            });
          } else if (parsedOptions.storeType === "mbtiles") {
            renderMBTilesTiles(
              id,
              parsedOptions.metadata,
              parsedOptions.tileScale,
              parsedOptions.tileSize,
              parsedOptions.bbox,
              parsedOptions.maxzoom,
              parsedOptions.concurrency,
              parsedOptions.storeMD5,
              parsedOptions.storeTransparent,
              parsedOptions.createOverview,
              parsedOptions.refreshBefore?.time ||
                parsedOptions.refreshBefore?.day ||
                parsedOptions.refreshBefore?.md5
            ).finally(() => {
              item.rendered.export = false;
            });
          } else if (parsedOptions.storeType === "pg") {
            renderPostgreSQLTiles(
              id,
              parsedOptions.metadata,
              parsedOptions.tileScale,
              parsedOptions.tileSize,
              parsedOptions.bbox,
              parsedOptions.maxzoom,
              parsedOptions.concurrency,
              parsedOptions.storeMD5,
              parsedOptions.storeTransparent,
              parsedOptions.createOverview,
              parsedOptions.refreshBefore?.time ||
                parsedOptions.refreshBefore?.day ||
                parsedOptions.refreshBefore?.md5
            ).finally(() => {
              item.rendered.export = false;
            });
          }
        }, 0);

        return res.status(StatusCodes.OK).send("OK");
      } catch (error) {
        printLog("error", `Failed to render style "${id}": ${error}`);

        if (error instanceof SyntaxError) {
          return res
            .status(StatusCodes.BAD_REQUEST)
            .send("option parameter is invalid");
        } else {
          return res
            .status(StatusCodes.INTERNAL_SERVER_ERROR)
            .send("Internal server error");
        }
      }
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
    const item = config.repo.styles[id];

    /* Check rendered is exist? */
    if (item === undefined || item.rendered === undefined) {
      return res.status(StatusCodes.NOT_FOUND).send("Rendered does not exist");
    }

    /* Get and check rendered tile scale (Default: 1). Ex: @2x -> 2 */
    const tileScale = Number(req.params.tileScale?.slice(1, -1)) || 1;

    /* Get tile size (Default: 256px x 256px) */
    const z = Number(req.params.z);
    const x = Number(req.params.x);
    const y = Number(req.params.y);
    const tileSize = Number(req.params.tileSize) || 256;

    /* Render tile */
    try {
      const image = await renderImage(
        tileScale,
        tileSize,
        item.rendered.compressionLevel,
        item.rendered.styleJSON,
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
    const item = config.repo.styles[id];

    /* Check rendered is exist? */
    if (item === undefined || item.rendered === undefined) {
      return res.status(StatusCodes.NOT_FOUND).send("Rendered does not exist");
    }

    /* Get render info */
    try {
      res.header("content-type", "application/json");

      return res.status(StatusCodes.OK).send({
        ...item.rendered.tileJSON,
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

      const result = [];

      Object.keys(config.repo.styles).map((id) => {
        const item = config.repo.styles[id].rendered;

        if (item !== undefined) {
          result.push({
            id: id,
            name: item.tileJSON.name,
            url: [
              `${requestHost}/styles/256/${id}.json`,
              `${requestHost}/styles/512/${id}.json`,
            ],
          });
        }
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
                printLog(
                  "info",
                  `Caching style "${id}" - File "${filePath}"...`
                );

                cacheStyleFile(
                  item.path,
                  JSON.stringify(styleJSON, null, 2)
                ).catch((error) =>
                  printLog(
                    "error",
                    `Failed to cache style "${id}" - File "${filePath}": ${error}`
                  )
                );
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
                  if (isLocalTileURL(source.url) === true) {
                    const sourceID = source.url.split("/")[2];

                    source.url = `${requestHost}/datas/${sourceID}.json`;
                  }
                }

                // Fix tileJSON URLs
                if (source.urls !== undefined) {
                  const urls = new Set(
                    source.urls.map((url) => {
                      if (isLocalTileURL(url) === true) {
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
                      if (isLocalTileURL(tile) === true) {
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

      const result = [];

      Object.keys(config.repo.styles).map((id) => {
        const item = config.repo.styles[id].rendered;

        if (item !== undefined) {
          result.push({
            ...item.tileJSON,
            id: id,
            tilejson: "2.2.0",
            scheme: "xyz",
            tiles: [`${requestHost}/styles/${id}/{z}/{x}/{y}.png`],
          });
        }
      });

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

    /**
     * @swagger
     * tags:
     *   - name: Style
     *     description: Style related endpoints
     * /styles/{id}/export/style.json:
     *   get:
     *     tags:
     *       - Style
     *     summary: Render style
     *     parameters:
     *       - in: query
     *         name: options
     *         schema:
     *           type: object
     *         required: false
     *         description: Style render options
     *     responses:
     *       200:
     *         description: Style render is started
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
    app.get(
      "/:id/export/style.json",
      checkReadyMiddleware(),
      renderStyleHandler()
    );

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
     * /styles/{id}/{tileSize}/{z}/{x}/{y}{tileScale}.png:
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
     *         name: tileScale
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
     *       400:
     *         description: Invalid params
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
      `/:id/(:tileSize(256|512)/)?:z(\\d+)/:x(\\d+)/:y(\\d+):tileScale(@\\d+x)?.png`,
      checkReadyMiddleware(),
      getRenderedTileHandler()
    );

    return app;
  },

  add: async () => {
    const seed = await readSeedFile(true);

    await Promise.all(
      Object.keys(config.styles).map(async (id) => {
        const item = config.styles[id];

        let isCanServeRendered = false;

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
              printLog(
                "info",
                `Downloading style file "${styleInfo.path}" from "${item.style}"...`
              );

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
            isCanServeRendered = true;
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
              isCanServeRendered = false;
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
        if (item.rendered !== undefined && isCanServeRendered === true) {
          try {
            /* Rendered info */
            const rendered = {
              tileJSON: createMetadata({
                name: styleInfo.name,
                description: styleInfo.name,
              }),
              styleJSON: {},
              compressionLevel: item.rendered.compressionLevel || 6,
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
                      if (isLocalTileURL(tile) === true) {
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
                    if (isLocalTileURL(url) === true) {
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
                  if (isLocalTileURL(source.url) === true) {
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
                    if (isLocalTileURL(source.tiles[0]) === true) {
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

            /* Add styleJSON */
            rendered.styleJSON = styleJSON;

            /* Add to repo */
            config.repo.styles[id].rendered = rendered;
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
