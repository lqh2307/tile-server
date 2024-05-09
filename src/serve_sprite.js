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
      "/:id/sprite:scale(@\\d+x)?.:format((png|json){1})",
      async (req, res, next) => {
        const id = decodeURI(req.params.id);
        const { scale = "", format = "" } = req.params;

        try {
          if (!repo[id]) {
            throw Error("Sprite is not found");
          }

          const filePath = `${path.join(spritePath, id, "sprite")}${scale}.${format}`;

          const data = await fs.promises.readFile(filePath);

          if (format === "json") {
            res.header("Content-type", "application/json");
          } else if (format === "png") {
            res.header("Content-type", "image/png");
          }

          res.header("Last-Modified", lastModified);

          return res.status(200).send(data);
        } catch (err) {
          printLog("error", `Failed to get sprite: ${err.message}`);

          res.header("Content-Type", "text/plain");

          return res.status(404).send("Sprite is not found");
        }
      }
    );

    app.get("/sprites.json", async (req, res, next) => {
      const result = Object.keys(repo).map((sprite) => {
        return {
          name: sprite,
          url: `${getUrl(req)}sprites/${sprite}/sprite`,
        };
      });

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
    const spritePath = config.options.paths.sprites;

    Object.keys(config.sprites).forEach(async (sprite) => {
      try {
        /* Validate sprite */
        const dirPath = path.join(spritePath, sprite);

        const fileNames = await findFiles(
          dirPath,
          /^sprite(@\d+x)?\.(png|json){1}$/
        );

        if (fileNames.length > 0) {
          repo[sprite] = true;
        } else {
          throw Error(`Sprite "${sprite}" is invalid`);
        }
      } catch (error) {
        printLog("error", `Failed to load sprite: ${error.message}`);
      }
    });

    return true;
  },
};
