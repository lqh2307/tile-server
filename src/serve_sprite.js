"use strict";

import fs from "node:fs";
import path from "node:path";
import express from "express";
import { printLog, findFiles, getUrl } from "./utils.js";

export const serve_sprite = {
  init: (config, repo) => {
    const app = express().disable("x-powered-by");
    const lastModified = new Date().toUTCString();
    const spritePath = config.options.paths.sprites;

    app.get(
      "/:id/sprite?:scale(@[23]x)?.:format([\\w]+)",
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
          const filePath = `${path.join(spritePath, id, "sprite")}${scale}.${format}`;

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

    app.get("/sprites.json", (req, res, next) => {
      const result = [];

      for (const sprite of Object.keys(repo)) {
        result.push({
          name: sprite,
          url: `${getUrl(req)}sprites/${sprite}/sprite`,
        });
      }

      res.header("Content-Type", "text/plain");
      res.header("Last-Modified", lastModified);

      return res.status(200).send(result);
    });

    return app;
  },

  remove: (repo, id) => {
    delete repo[id];
  },

  add: async (config, repo) => {
    const fontPath = config.options.paths.sprites;
    const sprites = Object.keys(config.sprites);

    try {
      for (const sprite of sprites) {
        const fileNames = await findFiles(
          path.join(fontPath, sprite),
          /^sprite(@(\d+)x){0,1}\.(json|png){1}$/
        );

        if (fileNames.length > 0) {
          repo[sprite] = true;
        }
      }
    } catch (err) {
      printLog("error", `Failed to load sprite: ${err.message}`);

      process.exit(1);
    }

    return true;
  },
};
