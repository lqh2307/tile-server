"use strict";

import { getRequestHost, isExistFile } from "./utils.js";
import { checkReadyMiddleware } from "./middleware.js";
import { StatusCodes } from "http-status-codes";
import { readSeedFile } from "./seed.js";
import { printLog } from "./logger.js";
import { config } from "./config.js";
import express from "express";
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

    /* Get style JSON */
    try {
      let styleJSON;

      try {
        styleJSON = await getStyle(item.path);
      } catch (error) {
        if (
          error.message === "Style does not exist" &&
          item.sourceURL !== undefined
        ) {
          printLog(
            "info",
            `Getting style "${id}" - From "${item.sourceURL}"...`
          );

          /* Get style */
          styleJSON = await getStyleJSONFromURL(
            item.sourceURL,
            60000 // 1 mins
          );

          /* Cache */
          if (item.storeCache === true) {
            cacheStyleFile(item.path, JSON.stringify(styleJSON, null, 2)).catch(
              (error) =>
                printLog(
                  "error",
                  `Failed to cache style "${id}" - From "${item.sourceURL}": ${error}`
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
              `${getRequestHost(req)}sprites/`
            );
          }
        }

        /* Fix fonts url */
        if (styleJSON.glyphs !== undefined) {
          if (styleJSON.glyphs.startsWith("fonts://") === true) {
            styleJSON.glyphs = styleJSON.glyphs.replaceAll(
              "fonts://",
              `${getRequestHost(req)}fonts/`
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
                const queryIndex = source.url.lastIndexOf("?");
                const sourceID =
                  queryIndex === -1
                    ? source.url.split("/")[2]
                    : source.url.split("/")[2].slice(0, queryIndex);

                source.url = `${getRequestHost(req)}datas/${sourceID}.json${
                  queryIndex === -1 ? "" : source.url.slice(queryIndex)
                }`;
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
                    const queryIndex = url.lastIndexOf("?");
                    const sourceID =
                      queryIndex === -1
                        ? url.split("/")[2]
                        : url.split("/")[2].slice(0, queryIndex);

                    url = `${getRequestHost(req)}datas/${sourceID}.json${
                      queryIndex === -1 ? "" : url.slice(queryIndex)
                    }`;
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
                    const queryIndex = tile.lastIndexOf("?");
                    const sourceID =
                      queryIndex === -1
                        ? tile.split("/")[2]
                        : tile.split("/")[2].slice(0, queryIndex);

                    tile = `${getRequestHost(
                      req
                    )}datas/${sourceID}/{z}/{x}/{y}.${
                      config.repo.datas[sourceID].tileJSON.format
                    }${queryIndex === -1 ? "" : tile.slice(queryIndex)}`;
                  }

                  return tile;
                })
              );

              source.tiles = Array.from(tiles);
            }
          })
        );
      }

      res.header("Content-Type", "application/json");

      return res.status(StatusCodes.OK).send(styleJSON);
    } catch (error) {
      printLog("error", `Failed to get style "${id}": ${error}`);

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
      const result = await Promise.all(
        Object.keys(config.repo.styles).map(async (id) => {
          return {
            id: id,
            name: config.repo.styles[id].name,
            url: `${getRequestHost(req)}styles/${id}/style.json`,
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

export const serve_style = {
  init: () => {
    const app = express();

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
     * /styles/{id}/style.json:
     *   get:
     *     tags:
     *       - Style
     *     summary: Get style
     *     parameters:
     *       - in: path
     *         name: id
     *         schema:
     *           type: string
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
     *         description: Style
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

    return app;
  },

  add: async () => {
    const seed = await readSeedFile(process.env.DATA_DIR, true);

    await Promise.all(
      Object.keys(config.styles).map(async (id) => {
        try {
          const item = config.styles[id];
          const styleInfo = {};

          if (
            item.style.startsWith("https://") === true ||
            item.style.startsWith("http://") === true
          ) {
            styleInfo.path = `${process.env.DATA_DIR}/styles/${id}/style.json`;

            if ((await isExistFile(styleInfo.path)) === false) {
              await downloadStyleFile(
                item.style,
                styleInfo.path,
                5,
                300000 // 5 mins
              );
            }
          } else {
            let cacheSource;

            if (item.cache !== undefined) {
              styleInfo.path = `${process.env.DATA_DIR}/caches/styles/${item.style}/style.json`;

              cacheSource = seed.styles[item.style];

              if (cacheSource === undefined) {
                throw new Error(`Cache style id "${item.style}" is invalid`);
              }

              if (item.cache.forward === true) {
                styleInfo.sourceURL = cacheSource.url;
                styleInfo.storeCache = item.cache.store;
              }
            } else {
              styleInfo.path = `${process.env.DATA_DIR}/styles/${item.style}`;
            }
          }

          /* Read style.json file */
          try {
            const styleJSON = await getStyle(styleInfo.path);

            /* Validate style */
            await validateStyle(styleJSON);

            /* Store style info */
            styleInfo.name = styleJSON.name || "Unknown";
            styleInfo.zoom = styleJSON.zoom || 0;
            styleInfo.center = styleJSON.center || [0, 0, 0];
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
      })
    );
  },
};
