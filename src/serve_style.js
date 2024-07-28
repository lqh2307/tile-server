"use strict";

import fs from "node:fs";
import path from "node:path";
import express from "express";
import { printLog, getURL, validateStyle } from "./utils.js";

function getStyleHandler(config) {
  return async (req, res, next) => {
    const id = decodeURI(req.params.id);
    const item = config.repo.styles[id];

    if (item === undefined) {
      return res.status(404).send("Style is not found");
    }

    /* Clone style JSON */
    const styleJSON = {
      ...item.styleJSON,
      sources: {},
    };

    /* Fix sprite url */
    if (styleJSON.sprite !== undefined) {
      if (styleJSON.sprite.startsWith("sprites://") === true) {
        styleJSON.sprite = styleJSON.sprite.replace(
          "sprites://",
          `${getURL(req)}sprites/`
        );
      }
    }

    /* Fix fonts url */
    if (styleJSON.glyphs !== undefined) {
      if (styleJSON.glyphs.startsWith("fonts://") === true) {
        styleJSON.glyphs = styleJSON.glyphs.replace(
          "fonts://",
          `${getURL(req)}fonts/`
        );
      }
    }

    /* Fix source urls */
    Object.keys(item.styleJSON.sources).forEach((id) => {
      const oldSource = item.styleJSON.sources[id];
      const sourceURL = oldSource.url;
      const sourceURLs = oldSource.urls;
      const sourceTiles = oldSource.tiles;

      styleJSON.sources[id] = {
        ...oldSource,
      };

      if (sourceURL !== undefined) {
        if (
          sourceURL.startsWith("mbtiles://") === true ||
          sourceURL.startsWith("pmtiles://") === true
        ) {
          const sourceID = sourceURL.slice(10);

          styleJSON.sources[id].url = `${getURL(req)}data/${sourceID}.json`;
        }
      }

      if (sourceURLs !== undefined) {
        const urls = sourceURLs.map((url) => {
          if (
            url.startsWith("pmtiles://") === true ||
            url.startsWith("mbtiles://") === true
          ) {
            const sourceID = url.slice(10);

            url = `${getURL(req)}data/${sourceID}.json`;
          }

          return url;
        });

        styleJSON.sources[id].urls = [...new Set(urls)];
      }

      if (sourceTiles !== undefined) {
        const tiles = sourceTiles.map((tile) => {
          if (
            tile.startsWith("pmtiles://") === true ||
            tile.startsWith("mbtiles://") === true
          ) {
            const sourceID = tile.slice(10);
            const format = config.repo.datas[sourceID].tileJSON.format;

            tile = `${getURL(req)}data/${sourceID}/{z}/{x}/{y}.${format}`;
          }

          return tile;
        });

        styleJSON.sources[id].tiles = [...new Set(tiles)];
      }
    });

    res.header("Content-Type", "application/json");

    return res.status(200).send(styleJSON);
  };
}

function getStylesListHandler(config) {
  return async (req, res, next) => {
    const styles = config.repo.styles;

    const result = Object.keys(styles).map((id) => {
      return {
        id: id,
        name: styles[id].styleJSON.name || "Unknown",
        url: `${getURL(req)}styles/${id}/style.json`,
      };
    });

    return res.status(200).send(result);
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

          const styleJSON = JSON.parse(fs.readFileSync(filePath));

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
