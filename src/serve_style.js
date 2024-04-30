"use strict";

import path from "node:path";
import fs from "node:fs";
import express from "express";
import { validateStyleMin } from "@maplibre/maplibre-gl-style-spec";
import { fixUrl, allowedOptions, logErr } from "./utils.js";
import clone from "clone";

const httpTester = /^https?:\/\//i;
const allowedSpriteScales = allowedOptions(["", "@2x", "@3x"]);
const allowedSpriteFormats = allowedOptions(["png", "json"]);

export const serve_style = {
  init: (options, repo) => {
    const app = express().disable("x-powered-by");

    app.get("/:id/style.json", (req, res, next) => {
      const item = repo[req.params.id];
      if (!item) {
        return res.sendStatus(404);
      }

      const styleJSON_ = clone(item.styleJSON || {});
      for (const name of Object.keys(styleJSON_.sources)) {
        const source = styleJSON_.sources[name];
        source.url = fixUrl(req, source.url);
      }

      // mapbox-gl-js viewer cannot handle sprite urls with query
      if (styleJSON_.sprite) {
        if (Array.isArray(styleJSON_.sprite)) {
          styleJSON_.sprite.forEach((spriteItem) => {
            spriteItem.url = fixUrl(req, spriteItem.url);
          });
        } else {
          styleJSON_.sprite = fixUrl(req, styleJSON_.sprite);
        }
      }

      if (styleJSON_.glyphs) {
        styleJSON_.glyphs = fixUrl(req, styleJSON_.glyphs);
      }

      return res.send(styleJSON_);
    });

    app.get(
      "/:id/sprite(/:spriteID)?:scale(@[23]x)?.:format([\\w]+)",
      (req, res, next) => {
        const { spriteID = "default", id } = req.params;
        const scale = allowedSpriteScales(req.params.scale) || "";
        const format = allowedSpriteFormats(req.params.format);

        if (format) {
          const item = repo[id];
          const sprite = item.spritePaths.find(
            (sprite) => sprite.id === spriteID
          );
          if (sprite) {
            const filename = `${sprite.path + scale}.${format}`;
            return fs.readFile(filename, (err, data) => {
              if (err) {
                logErr(`Sprite load error: ${filename}`);

                return res.sendStatus(404);
              } else {
                if (format === "json")
                  res.header("Content-type", "application/json");
                if (format === "png") res.header("Content-type", "image/png");

                return res.send(data);
              }
            });
          } else {
            return res.status(400).send("Bad Sprite ID or Scale");
          }
        } else {
          return res.status(400).send("Bad Sprite Format");
        }
      }
    );

    return app;
  },

  remove: (repo, id) => {
    delete repo[id];
  },

  add: (options, repo, params, id, reportTiles, reportFont) => {
    const styleFile = path.resolve(options.paths.styles, params.style);

    let styleJSON = {};
    try {
      styleJSON = JSON.parse(fs.readFileSync(styleFile));
    } catch (e) {
      logErr(`Failed to reading style file: ${e.message}`);

      return false;
    }

    const validationErrors = validateStyleMin(styleJSON);
    if (validationErrors.length > 0) {
      let errString = `The file "${params.style}" is not a valid style file:`;

      for (const err of validationErrors) {
        errString += "\n" + `${err.line}: ${err.message}`;
      }

      logErr(errString);

      return false;
    }

    for (const name of Object.keys(styleJSON.sources) || {}) {
      const source = styleJSON.sources[name];
      let url = source.url;
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

        source.url = `local://data/${identifier}.json`;
      }
    }

    for (const obj of styleJSON.layers) {
      if (obj["type"] === "symbol") {
        const fonts = (obj["layout"] || {})["text-font"];
        if (fonts && fonts.length) {
          fonts.forEach(reportFont);
        } else {
          reportFont("Open Sans Regular");
          reportFont("Arial Unicode MS Regular");
        }
      }
    }

    let spritePaths = [];
    if (styleJSON.sprite) {
      if (!Array.isArray(styleJSON.sprite)) {
        if (!httpTester.test(styleJSON.sprite)) {
          let spritePath = path.join(
            options.paths.sprites,
            styleJSON.sprite
              .replace("{style}", path.basename(styleFile, ".json"))
              .replace(
                "{styleJsonFolder}",
                path.relative(options.paths.sprites, path.dirname(styleFile))
              )
          );
          styleJSON.sprite = `local://styles/${id}/sprite`;
          spritePaths.push({ id: "default", path: spritePath });
        }
      } else {
        for (let spriteItem of styleJSON.sprite) {
          if (!httpTester.test(spriteItem.url)) {
            let spritePath = path.join(
              options.paths.sprites,
              spriteItem.url
                .replace("{style}", path.basename(styleFile, ".json"))
                .replace(
                  "{styleJsonFolder}",
                  path.relative(options.paths.sprites, path.dirname(styleFile))
                )
            );
            spriteItem.url = `local://styles/${id}/sprite/` + spriteItem.id;
            spritePaths.push({ id: spriteItem.id, path: spritePath });
          }
        }
      }
    }

    if (styleJSON.glyphs && !httpTester.test(styleJSON.glyphs)) {
      styleJSON.glyphs = "local://fonts/{fontstack}/{range}.pbf";
    }

    repo[id] = {
      styleJSON,
      spritePaths,
      name: styleJSON.name,
    };

    return true;
  },
};
