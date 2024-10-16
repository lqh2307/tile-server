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
          styleJSON.sprite = styleJSON.sprite.replace(
            "sprites://",
            `${getRequestHost(req)}sprites/`
          );
        }
      }

      /* Fix fonts url */
      if (styleJSON.glyphs !== undefined) {
        if (styleJSON.glyphs.startsWith("fonts://") === true) {
          styleJSON.glyphs = styleJSON.glyphs.replace(
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
              source.url.startsWith("pmtiles://") === true
            ) {
              const sourceID = source.url.slice(10);

              source.url = `${getRequestHost(req)}data/${sourceID}.json`;
            }
          }

          if (source.urls !== undefined) {
            const urls = source.urls.map((url) => {
              if (
                url.startsWith("pmtiles://") === true ||
                url.startsWith("mbtiles://") === true
              ) {
                const sourceID = url.slice(10);

                url = `${getRequestHost(req)}data/${sourceID}.json`;
              }

              return url;
            });

            source.urls = [...new Set(urls)];
          }

          if (source.tiles !== undefined) {
            const tiles = source.tiles.map((tile) => {
              if (
                tile.startsWith("pmtiles://") === true ||
                tile.startsWith("mbtiles://") === true
              ) {
                const sourceID = tile.slice(10);
                const format = config.repo.datas[sourceID].tileJSON.format;

                tile = `${getRequestHost(
                  req
                )}data/${sourceID}/{z}/{x}/{y}.${format}`;
              }

              return tile;
            });

            source.tiles = [...new Set(tiles)];
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
      const result = Object.keys(config.repo.styles).map((id) => {
        return {
          id: id,
          name: config.repo.styles[id].styleJSON.name || "Unknown",
          url: `${getRequestHost(req)}styles/${id}/style.json`,
        };
      });

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
