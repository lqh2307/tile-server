"use strict";

import path from "node:path";
import fs from "node:fs";
import express from "express";
import { validateStyleMin } from "@maplibre/maplibre-gl-style-spec";
import { fixUrl, printLog, getUrl } from "./utils.js";
import clone from "clone";

export const serve_style = {
  init: async (config, repo) => {
    const app = express().disable("x-powered-by");
    const lastModified = new Date().toUTCString();

    app.get("/:id/style.json", async (req, res, next) => {
      const id = decodeURI(req.params.id);
      const item = repo[id];

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
      const result = Object.keys(repo).map((id) => {
        return {
          id: id,
          name: repo[id].styleJSON.name,
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
    delete repo[id];
  },

  add: (config, repo, params, id, reportTiles) => {
    const stylePath = config.options.paths.styles;
    const styleFilePath = path.resolve(stylePath, params.style);

    let styleJSON = {};

    try {
      styleJSON = JSON.parse(fs.readFileSync(styleFilePath));
    } catch (error) {
      printLog("error", `Failed to load style file: ${error.message}`);

      return false;
    }

    /* Validate style */
    const validationErrors = validateStyleMin(styleJSON);
    if (validationErrors.length > 0) {
      let errString = `Style "${params.style}" is invalid:`;

      for (const err of validationErrors) {
        errString += "\n" + `${err.line}: ${err.message}`;
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
        const protocol = url.split(":")[0];

        let dataId = url.replace("pmtiles://", "").replace("mbtiles://", "");
        if (dataId.startsWith("{") && dataId.endsWith("}")) {
          dataId = dataId.slice(1, -1);
        }

        const mapsTo = (params.mapping || {})[dataId];
        if (mapsTo) {
          dataId = mapsTo;
        }

        const identifier = reportTiles(dataId, protocol);
        if (!identifier) {
          return false;
        }

        styleJSON.sources[name].url = `local://data/${identifier}.json`;
      }
    }

    if (styleJSON.sprite && styleJSON.sprite.startsWith("sprites://")) {
      styleJSON.sprite = styleJSON.sprite.replace(
        "sprites://",
        "local://sprites/"
      );
    }

    if (styleJSON.glyphs && styleJSON.glyphs.startsWith("fonts://")) {
      styleJSON.glyphs = styleJSON.glyphs.replace("fonts://", "local://fonts/");
    }

    repo[id] = {
      styleJSON,
      name: styleJSON.name,
    };

    return true;
  },
};
