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

    /* Clone style JSON */
    const styleJSON = JSON.parse(JSON.stringify(item.styleJSON));

    /* Fix url */
    Object.values(styleJSON.sources).forEach((source) => {
      source.url = fixUrl(req, source.url);
    });

    styleJSON.sprite = fixUrl(req, styleJSON.sprite);
    styleJSON.glyphs = fixUrl(req, styleJSON.glyphs);

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

          const styleJSON = JSON.parse(
            fs.readFileSync(
              path.resolve(config.options.paths.styles, stylePath)
            )
          );

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
