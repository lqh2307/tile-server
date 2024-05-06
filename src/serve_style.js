"use strict";

import path from "node:path";
import fs from "node:fs";
import express from "express";
import { validateStyleMin } from "@maplibre/maplibre-gl-style-spec";
import { fixUrl, printLog, getUrl } from "./utils.js";
import clone from "clone";

const httpTester = /^https?:\/\//i;

export const serve_style = {
  init: (options, repo) => {
    const app = express().disable("x-powered-by");
    const lastModified = new Date().toUTCString();
    const stylePath = options.paths.styles;

    app.get("/:id/style.json", (req, res, next) => {
      const { id } = req.params
      const item = repo[id];

      if (!item) {
        return res.status(400).send("Style is not found");
      }

      const styleJSON = clone(item.styleJSON || {});

      if (styleJSON.sources) {
        for (const name of Object.keys(styleJSON.sources)) {
          source.url = fixUrl(req, styleJSON.sources[name].url);
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

      return res.send(styleJSON);
    });

    app.get("/styles.json", (req, res, next) => {
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

    app.get(
      "/:id/sprite:scale(@[23]x)?.:format([\\w]+)",
      async (req, res, next) => {
        const id = decodeURI(req.params.id);
        const { scale = "", format = "" } = req.params;

        if (format != "png" && format != "json") {
          res.header("Content-Type", "text/plain");

          return res.status(400).send("Invalid format");
        }

        if (!repo[id]) {
          res.header("Content-Type", "text/plain");

          return res.status(404).send("Sprite id or scale is not found");
        }

        try {
          const filePath = `${path.join(stylePath, id, "sprites", "sprite")}${scale}.${format}`;

          const data = fs.readFileSync(filePath);

          if (format === "json") {
            res.header("Content-type", "application/json");
          } else if (format === "png") {
            res.header("Content-type", "image/png");
          }

          return res.status(200).send(data);
        } catch (err) {
          printLog("error", `Failed to get sprite: ${err.message}`);

          res.header("Content-Type", "text/plain");

          return res.status(400).send("Sprite is not found");
        }
      }
    );

    return app;
  },

  remove: (repo, id) => {
    delete repo[id];
  },

  add: (options, repo, params, id, reportTiles) => {
    const stylePath = options.paths.styles;
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

    if (styleJSON.sprite && !httpTester.test(styleJSON.sprite)) {
      styleJSON.sprite = `local://styles/${id}/sprite`;
    }

    if (styleJSON.glyphs && !httpTester.test(styleJSON.glyphs)) {
      styleJSON.glyphs = "local://fonts/{fontstack}/{range}.pbf";
    }

    repo[id] = {
      styleJSON,
      name: styleJSON.name,
    };

    return true;
  },
};
