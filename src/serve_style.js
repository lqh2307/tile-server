"use strict";

import path from "node:path";
import fs from "node:fs";
import express from "express";
import { validateStyleMin } from "@maplibre/maplibre-gl-style-spec";
import { fixUrl, printLog, getUrl } from "./utils.js";
import clone from "clone";
import { serve_rendered } from "./serve_rendered.js";

export const serve_style = {
  init: async (config, repo) => {
    const app = express().disable("x-powered-by");
    const lastModified = new Date().toUTCString();

    app.get("/:id/style.json", async (req, res, next) => {
      const id = decodeURI(req.params.id);
      const item = repo.styles[id];

      if (!item) {
        res.header("Content-Type", "text/plain");

        return res.status(404).send("Style is not found");
      }

      const styleJSON = clone(item.styleJSON || {});

      if (styleJSON.sources) {
        Object.keys(styleJSON.sources).forEach(
          (source) =>
            (styleJSON.sources[source].url = fixUrl(
              req,
              styleJSON.sources[source].url
            ))
        );
      }

      if (styleJSON.sprite) {
        styleJSON.sprite = fixUrl(req, styleJSON.sprite);
      }

      if (styleJSON.glyphs) {
        styleJSON.glyphs = fixUrl(req, styleJSON.glyphs);
      }

      res.header("Content-Type", "application/json");
      res.header("Last-Modified", lastModified);

      return res.status(200).send(styleJSON);
    });

    app.get("/styles.json", async (req, res, next) => {
      const result = Object.keys(repo.styles).map((id) => {
        return {
          id: id,
          name: repo.styles[id].styleJSON.name,
          url: `${getUrl(req)}styles/${id}/style.json`,
        };
      });

      res.header("Content-Type", "text/plain");
      res.header("Last-Modified", lastModified);

      res.status(200).send(result);
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
      styles.map(async (id) => {
        const item = config.styles[id];
        if (!item.style) {
          printLog("error", `Missing "style" property for ${id}`);

          return;
        }

        const styleFilePath = path.resolve(stylePath, id, "style.json");

        let styleJSON = {};

        try {
          const file = fs.readFileSync(styleFilePath);

          styleJSON = JSON.parse(file);
        } catch (error) {
          printLog("error", `Failed to load style "${id}": ${error.message}`);

          return false;
        }

        /* Validate style */
        const validationErrors = validateStyleMin(styleJSON);
        if (validationErrors.length > 0) {
          let errString = `Failed to load style "${id}": Style is invalid:`;

          for (const err of validationErrors) {
            errString += "\n\t" + `${err.message}`;
          }

          printLog("error", errString);

          return false;
        }

        for (const name of Object.keys(styleJSON.sources) || {}) {
          let url = styleJSON.sources[name].url;

          if (
            url &&
            (url.startsWith("pmtiles://") || url.startsWith("mbtiles://"))
          ) {
            let dataId = url
              .replace("pmtiles://", "")
              .replace("mbtiles://", "");
            if (dataId.startsWith("{") && dataId.endsWith("}")) {
              dataId = dataId.slice(1, -1);
            }

            if (!Object.keys(config.data).includes(dataId)) {
              return false;
            }

            styleJSON.sources[name].url = `local://data/${dataId}.json`;
          }
        }

        if (styleJSON.sprite && styleJSON.sprite.startsWith("sprites://")) {
          styleJSON.sprite = styleJSON.sprite.replace(
            "sprites://",
            "local://sprites/"
          );
        }

        if (styleJSON.glyphs && styleJSON.glyphs.startsWith("fonts://")) {
          styleJSON.glyphs = styleJSON.glyphs.replace(
            "fonts://",
            "local://fonts/"
          );
        }

        repo.styles[id] = {
          styleJSON,
          name: styleJSON.name,
        };

        return await serve_rendered.add(config, repo, config.styles[id], id);
      })
    );
  },
};
