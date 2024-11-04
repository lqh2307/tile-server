"use strict";

import { getRequestHost, validateStyle, printLog } from "./utils.js";
import { StatusCodes } from "http-status-codes";
import fsPromise from "node:fs/promises";
import { config } from "./config.js";
import express from "express";

function getStyleHandler() {
  return async (req, res, next) => {
    const id = decodeURI(req.params.id);
    const item = config.repo.styles[id];

    if (item === undefined) {
      return res.status(StatusCodes.NOT_FOUND).send("Style is not found");
    }

    try {
      /* Clone style JSON */
      const stringJSON = JSON.stringify(item.styleJSON);
      const styleJSON = JSON.parse(stringJSON);

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
          const stylePath = config.styles[id].style;

          if (!stylePath) {
            throw new Error(`"style" property is empty`);
          }

          /* Read style json file */
          const filePath = `${config.paths.styles}/${stylePath}`;
          const fileData = await fsPromise.readFile(filePath, "utf-8");
          const styleJSON = JSON.parse(fileData);

          /* Validate style */
          await validateStyle(config, styleJSON);

          /* Add to repo */
          config.repo.styles[id] = {
            styleJSON: styleJSON,
          };
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
