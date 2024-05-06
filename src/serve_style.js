"use strict";

import path from "node:path";
import fs from "node:fs";
import express from "express";
import { validateStyleMin } from "@maplibre/maplibre-gl-style-spec";
import { fixUrl, printLog, getUrl } from "./utils.js";
import clone from "clone";

export const serve_style = {
  init: (config, repo) => {
    const app = express().disable("x-powered-by");
    const lastModified = new Date().toUTCString();

    app.get("/:id/style.json", async (req, res, next) => {
      const { id } = req.params;
      const item = repo[id];

      if (!item) {
        return res.status(400).send("Style is not found");
      }

      const styleJSON = clone(item.styleJSON || {});

      if (styleJSON.sources) {
        for (const name of Object.keys(styleJSON.sources)) {
          styleJSON.sources[name].url = fixUrl(
            req,
            styleJSON.sources[name].url
          );
        }
      }

      // mapbox-gl-js viewer cannot handle sprite urls with query
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
      const result = [];

      for (const id of Object.keys(repo)) {
        result.push({
          id: id,
          version: repo[id].styleJSON.version,
          name: repo[id].styleJSON.name,
          url: `${getUrl(req)}styles/${id}/style.json`,
        });
      }

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
    } catch (e) {
      printLog("error", `Failed to reading style file: ${e.message}`);

      return false;
    }

    /* Validate style */
    const validationErrors = validateStyleMin(styleJSON);
    if (validationErrors.length > 0) {
      let errString = `The file "${params.style}" is not a valid style file:`;

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
