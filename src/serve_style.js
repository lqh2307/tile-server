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

    const sources = {};
    Object.keys(item.styleJSON.sources).forEach((name) => {
      sources[name] = {
        ...item.styleJSON.sources[name],
        url: fixUrl(req, item.styleJSON.sources[name].url),
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
    const styles = Object.keys(config.repo.styles);

    const result = styles.map((style) => {
      const item = config.repo.styles[style];

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

  remove: async (config) => {
    config.repo.styles = {};
  },

  add: async (config) => {
    const styles = Object.keys(config.styles);

    await Promise.all(
      styles.map(async (style) => {
        const item = config.styles[style];

        try {
          if (!item.style) {
            throw Error(`"style" property is empty`);
          }

          const styleJSON = JSON.parse(
            fs.readFileSync(
              path.resolve(config.options.paths.styles, item.style)
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
            const source = styleJSON.sources[name];

            if (
              source.url?.startsWith("pmtiles://") === true ||
              source.url?.startsWith("mbtiles://") === true
            ) {
              const sourceURL = source.url.slice(10);

              if (
                sourceURL.startsWith("{") === false ||
                sourceURL.endsWith("}") === false
              ) {
                throw Error(`Source data "${name}" is invalid`);
              }

              const sourceID = sourceURL.slice(1, -1);

              if (!config.repo.data[sourceID]) {
                throw Error(`Source data "${name}" is not found`);
              }

              source.url = `local://data/${sourceID}.json`;
            }
          });

          if (styleJSON.sprite?.startsWith("sprites://") === true) {
            styleJSON.sprite = styleJSON.sprite.replace(
              "sprites://",
              "local://sprites/"
            );
          }

          if (styleJSON.glyphs?.startsWith("fonts://") === true) {
            styleJSON.glyphs = styleJSON.glyphs.replace(
              "fonts://",
              "local://fonts/"
            );
          }

          config.repo.styles[style] = {
            styleJSON,
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
