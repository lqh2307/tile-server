"use strict";

import { validateStyleMin } from "@maplibre/maplibre-gl-style-spec";
import { getRequestHost, deepClone, getDataJSON } from "./utils.js";
import { StatusCodes } from "http-status-codes";
import fsPromise from "node:fs/promises";
import { printLog } from "./logger.js";
import { config } from "./config.js";
import express from "express";

/**
 * Validate style
 * @param {object} styleJSON Style JSON
 * @returns {Promise<void>}
 */
async function validateStyle(styleJSON) {
  /* Validate style */
  const validationErrors = validateStyleMin(styleJSON);
  if (validationErrors.length > 0) {
    throw new Error(
      validationErrors
        .map((validationError) => `\n\t${validationError.message}`)
        .join()
    );
  }

  /* Validate fonts */
  if (styleJSON.glyphs !== undefined) {
    if (
      styleJSON.glyphs.startsWith("fonts://") === false &&
      styleJSON.glyphs.startsWith("https://") === false &&
      styleJSON.glyphs.startsWith("http://") === false
    ) {
      throw new Error("Invalid fonts url");
    }
  }

  /* Validate sprite */
  if (styleJSON.sprite !== undefined) {
    if (styleJSON.sprite.startsWith("sprites://") === true) {
      const spriteID = styleJSON.sprite.slice(
        10,
        styleJSON.sprite.lastIndexOf("/")
      );

      if (config.repo.sprites[spriteID] === undefined) {
        throw new Error(`Sprite "${spriteID}" is not found`);
      }
    } else if (
      styleJSON.sprite.startsWith("https://") === false &&
      styleJSON.sprite.startsWith("http://") === false
    ) {
      throw new Error("Invalid sprite url");
    }
  }

  /* Validate sources */
  await Promise.all(
    Object.keys(styleJSON.sources).map(async (id) => {
      const source = styleJSON.sources[id];

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

          if (config.repo.datas[sourceID] === undefined) {
            throw new Error(
              `Source "${id}" is not found data source "${sourceID}"`
            );
          }
        } else if (
          source.url.startsWith("https://") === false &&
          source.url.startsWith("http://") === false
        ) {
          throw new Error(`Source "${id}" is invalid data url "${url}"`);
        }
      }

      if (source.urls !== undefined) {
        if (source.urls.length === 0) {
          throw new Error(`Source "${id}" is invalid data urls`);
        }

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

            if (config.repo.datas[sourceID] === undefined) {
              throw new Error(
                `Source "${id}" is not found data source "${sourceID}"`
              );
            }
          } else if (
            url.startsWith("https://") === false &&
            url.startsWith("http://") === false
          ) {
            throw new Error(`Source "${id}" is invalid data url "${url}"`);
          }
        });
      }

      if (source.tiles !== undefined) {
        if (source.tiles.length === 0) {
          throw new Error(`Source "${id}" is invalid tile urls`);
        }

        source.tiles.forEach((tile) => {
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

            if (config.repo.datas[sourceID] === undefined) {
              throw new Error(
                `Source "${id}" is not found data source "${sourceID}"`
              );
            }
          } else if (
            tile.startsWith("https://") === false &&
            tile.startsWith("http://") === false
          ) {
            throw new Error(`Source "${id}" is invalid tile url "${url}"`);
          }
        });
      }
    })
  );
}

function getStyleHandler() {
  return async (req, res, next) => {
    const id = req.params.id;
    const item = config.repo.styles[id];

    if (item === undefined) {
      return res.status(StatusCodes.NOT_FOUND).send("Style is not found");
    }

    try {
      /* Clone style JSON */
      const styleJSON = deepClone(item.styleJSON);

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

                  tile = `${getRequestHost(req)}datas/${sourceID}/{z}/{x}/{y}.${
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

function getStylesListHandler() {
  return async (req, res, next) => {
    try {
      const result = await Promise.all(
        Object.keys(config.repo.styles).map(async (id) => {
          return {
            id: id,
            name: config.repo.styles[id].styleJSON.name || "Unknown",
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
    app.get("/styles.json", getStylesListHandler());

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
    app.get("/:id/style.json", getStyleHandler());

    return app;
  },

  add: async () => {
    await Promise.all(
      Object.keys(config.styles).map(async (id) => {
        try {
          const item = config.styles[id];
          const styleInfo = {};

          if (
            item.style.startsWith("https://") === true ||
            item.style.startsWith("http://") === true
          ) {
            styleInfo.path = item.style;

            /* Get style from URL */
            const response = await getDataJSON(
              styleInfo.path,
              60000 // 1 mins
            );

            styleInfo.styleJSON = response.data;
          } else {
            styleInfo.path = `${config.paths.styles}/${item.style}`;

            /* Read style.json file */
            const styleData = await fsPromise.readFile(styleInfo.path, "utf8");

            styleInfo.styleJSON = JSON.parse(styleData);
          }

          /* Validate style */
          await validateStyle(styleInfo.styleJSON);

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
