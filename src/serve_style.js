"use strict";

import fs from "node:fs";
import path from "node:path";
import express from "express";
import { validateStyleMin } from "@maplibre/maplibre-gl-style-spec";
import { fixUrl, printLog, getUrl } from "./utils.js";

function getStyleHandler(config) {
  return async (req, res, next) => {
    const id = decodeURI(req.params.id);
    const item = config.repo.styles[id];

    if (!item) {
      return res.status(404).send("Style is not found");
    }

    /* Clone style JSON & Fix urls */
    const sources = {};
    Object.keys(item.styleJSON.sources).forEach((source) => {
      sources[source] = {
        ...item.styleJSON.sources[source],
        url: fixUrl(req, item.styleJSON.sources[source].url),
      };
    });

    const styleJSON = {
      ...item.styleJSON,
      sources: sources,
      sprite: fixUrl(req, item.styleJSON.sprite),
      glyphs: fixUrl(req, item.styleJSON.glyphs),
    };

    res.header("Content-Type", "application/json");

    return res.status(200).send(styleJSON);
  };
}

function getStylesListHandler(config) {
  return async (req, res, next) => {
    const styles = config.repo.styles;

    const result = Object.keys(styles).map((style) => {
      const item = styles[style];

      return {
        id: style,
        name: item.styleJSON.name || "",
        url: `${getUrl(req)}styles/${style}/style.json`,
      };
    });

    return res.status(200).send(result);
  };
}

export const serve_style = {
  init: (config) => {
    const app = express();

    app.get("/styles.json", getStylesListHandler(config));
    app.get("/:id/style.json", getStyleHandler(config));

    return app;
  },

  add: async (config) => {
    await Promise.all(
      Object.keys(config.styles).map(async (style) => {
        const stylePath = config.styles[style].style;

        try {
          if (!stylePath) {
            throw Error(`"style" property is empty`);
          }

          const filePath = path.join(config.options.paths.styles, stylePath);

          const file = fs.readFileSync(filePath);

          const styleJSON = JSON.parse(file);

          /* Validate style */
          const validationErrors = validateStyleMin(styleJSON);
          if (validationErrors.length > 0) {
            let errString = "Style is invalid:";

            for (const error of validationErrors) {
              errString += "\n\t" + `${error.message}`;
            }

            throw Error(errString);
          }

          Object.keys(styleJSON.sources).forEach((source) => {
            const sourceUrl = styleJSON.sources[source].url;

            if (
              sourceUrl?.startsWith("pmtiles://") === true ||
              sourceUrl?.startsWith("mbtiles://") === true
            ) {
              const sourceID = sourceUrl.slice(11, -1);

              if (!config.repo.datas[sourceID]) {
                throw Error(`Source data "${source}" is not found`);
              }
            }
          });

          /* Add to repo */
          config.repo.styles[style] = {
            styleJSON: styleJSON,
          };
        } catch (error) {
          printLog(
            "error",
            `Failed to load style "${style}": ${error}. Skipping...`
          );
        }
      })
    );
  },
};
