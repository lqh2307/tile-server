"use strict";

import path from "node:path";
import fs from "node:fs";
import express from "express";
import clone from "clone";
import { validateStyleMin } from "@maplibre/maplibre-gl-style-spec";
import { fixUrl, printLog, getUrl } from "./utils.js";

export const serve_style = {
  init: async (config, repo) => {
    const app = express();
    const lastModified = new Date().toUTCString();

    app.get("/:id/style.json", async (req, res, next) => {
      const id = decodeURI(req.params.id);
      const item = repo.styles[id];

      try {
        if (!item) {
          throw Error("Style is not found");
        }

        const styleJSON = clone(item.styleJSON);

        Object.keys(styleJSON.sources || {}).forEach((name) => {
          const source = styleJSON.sources[name];

          source.url = fixUrl(req, source.url);
        });

        if (styleJSON.sprite) {
          styleJSON.sprite = fixUrl(req, styleJSON.sprite);
        }

        if (styleJSON.glyphs) {
          styleJSON.glyphs = fixUrl(req, styleJSON.glyphs);
        }

        res.header("Content-Type", "application/json");
        res.header("Last-Modified", lastModified);

        return res.status(200).send(styleJSON);
      } catch (error) {
        printLog("error", `Failed to get style "${id}": ${error}`);

        res.header("Content-Type", "text/plain");

        return res.status(404).send("Style is not found");
      }
    });

    app.get("/styles.json", async (req, res, next) => {
      const styles = Object.keys(repo.styles);

      const result = styles.map((style) => {
        const item = repo.styles[style];

        return {
          id: style,
          name: item.styleJSON.name,
          url: `${getUrl(req)}styles/${style}/style.json`,
        };
      });

      res.header("Content-Type", "text/plain");
      res.header("Last-Modified", lastModified);

      return res.status(200).send(result);
    });

    return app;
  },

  remove: (repo, id) => {
    delete repo.styles[id];
  },

  add: async (config, repo) => {
    const stylePath = config.options.paths.styles;
    const styles = Object.keys(config.styles);

    await Promise.all(
      styles.map(async (style) => {
        try {
          const item = config.styles[style];

          if (!item.style) {
            throw Error(`"style" property for style "${style}" is empty`);
          }

          const styleFilePath = path.resolve(stylePath, item.style);

          const file = fs.readFileSync(styleFilePath);

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

          Object.keys(styleJSON.sources || {}).forEach((name) => {
            const source = styleJSON.sources[name];

            if (
              source.url?.startsWith("pmtiles://") ||
              source.url?.startsWith("mbtiles://")
            ) {
              const sourceURL = source.url.slice(10);

              if (!sourceURL.startsWith("{") || !sourceURL.endsWith("}")) {
                throw Error(`Source data "${name}" is invalid`);
              }

              const sourceID = sourceURL.slice(1, -1);

              if (!repo.data[sourceID]) {
                throw Error(`Source data "${name}" is not found`);
              }

              source.url = `local://data/${sourceID}.json`;
            }
          });

          if (styleJSON.sprite?.startsWith("sprites://")) {
            styleJSON.sprite = styleJSON.sprite.replace(
              "sprites://",
              "local://sprites/"
            );
          }

          if (styleJSON.glyphs?.startsWith("fonts://")) {
            styleJSON.glyphs = styleJSON.glyphs.replace(
              "fonts://",
              "local://fonts/"
            );
          }

          repo.styles[style] = {
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
