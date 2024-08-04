"use strict";

import { getRequestHost, validateStyle, printLog } from "./utils.js";
import { StatusCodes } from "http-status-codes";
import fs from "node:fs/promises";
import express from "express";
import path from "node:path";

function getStyleHandler(config) {
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
      Object.keys(styleJSON.sources).forEach((id) => {
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

              tile = `${getRequestHost(req)}data/${sourceID}/{z}/{x}/{y}.${format}`;
            }

            return tile;
          });

          source.tiles = [...new Set(tiles)];
        }
      });

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

function getStylesListHandler(config) {
  return async (req, res, next) => {
    try {
      const styles = config.repo.styles;

      const result = Object.keys(styles).map((id) => {
        return {
          id: id,
          name: styles[id].styleJSON.name || "Unknown",
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
  init: (config) => {
    const app = express();

    /* Get style */
    app.get("/:id/style.json", getStyleHandler(config));

    /* Get all styles */
    app.get("/styles.json", getStylesListHandler(config));

    return app;
  },

  add: async (config) => {
    await Promise.all(
      Object.keys(config.styles).map(async (id) => {
        try {
          const stylePath = config.styles[id].style;

          if (!stylePath) {
            throw new Error(`"style" property is empty`);
          }

          /* Read style json file */
          const filePath = path.join(config.options.paths.styles, stylePath);
          const fileData = await fs.readFile(filePath, "utf-8");
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
