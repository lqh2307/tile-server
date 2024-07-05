"use strict";

import express from "express";
import path from "node:path";
import fs from "node:fs";
import { validateStyleMin } from "@maplibre/maplibre-gl-style-spec";
import { fixUrl, printLog, getUrl } from "./utils.js";

function getStyleHandler(config) {
  return async (req, res, next) => {
    const id = decodeURI(req.params.id);
    const item = config.repo.styles[id];

    if (!item) {
      return res.status(404).send("Style is not found");
    }

    try {
      /* Clone style JSON */
      const stringJSON = JSON.stringify(item.styleJSON);

      const styleJSON = JSON.parse(stringJSON);

      /* Fix url */
      Object.values(styleJSON.sources).forEach((source) => {
        source.url = fixUrl(req, source.url);
      });

      styleJSON.sprite = fixUrl(req, styleJSON.sprite);
      styleJSON.glyphs = fixUrl(req, styleJSON.glyphs);

      res.header("Content-Type", "application/json");

      return res.status(200).send(styleJSON);
    } catch (error) {
      printLog("error", `Failed to get style "${id}": ${error}`);

      return res.status(404).send("Style is not found");
    }
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

          Object.keys(styleJSON.sources).forEach((name) => {
            const sourceUrl = styleJSON.sources[name].url;

            if (
              sourceUrl?.startsWith("pmtiles://") === true ||
              sourceUrl?.startsWith("mbtiles://") === true
            ) {
              const sourceID = sourceUrl.slice(11, -1);

              if (!config.repo.datas[sourceID]) {
                throw Error(`Source data "${name}" is not found`);
              }
            }
          });

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
