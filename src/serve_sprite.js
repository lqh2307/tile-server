"use strict";

import fs from "node:fs";
import path from "node:path";
import express from "express";
import { printLog, getUrl, validateSprite } from "./utils.js";

export const serve_sprite = {
  init: async (config) => {
    const app = express();
    const spritePath = config.options.paths.sprites;

    app.get(
      "/:id/sprite:scale(@\\d+x)?.:format((png|json){1})",
      async (req, res, next) => {
        const id = decodeURI(req.params.id);
        const { scale = "", format = "" } = req.params;
        const item = config.repo.sprites[id];

        try {
          if (!item) {
            throw Error("Sprite is not found");
          }

          const filePath = `${path.join(spritePath, id, "sprite")}${scale}.${format}`;

          const data = fs.readFileSync(filePath);

          if (format === "json") {
            res.header("Content-type", "application/json");
          } else if (format === "png") {
            res.header("Content-type", "image/png");
          }

          return res.status(200).send(data);
        } catch (error) {
          printLog("error", `Failed to get sprite "${id}": ${error}`);

          res.header("Content-Type", "text/plain");

          return res.status(404).send("Sprite is not found");
        }
      }
    );

    app.get("/sprites.json", async (req, res, next) => {
      const sprites = Object.keys(config.repo.sprites);

      const result = sprites.map((sprite) => {
        return {
          name: sprite,
          url: `${getUrl(req)}sprites/${sprite}/sprite`,
        };
      });

      res.header("Content-Type", "text/plain");

      return res.status(200).send(result);
    });

    return app;
  },

  remove: (config, id) => {
    delete config.repo.sprites[id];
  },

  add: async (config) => {
    const spritePath = config.options.paths.sprites;
    const sprites = Object.keys(config.sprites);

    await Promise.all(
      sprites.map(async (sprite) => {
        try {
          /* Validate sprite */
          const spriteDirPath = path.join(spritePath, sprite);

          validateSprite(spriteDirPath);

          config.repo.sprites[sprite] = true;
        } catch (error) {
          printLog("error", `Failed to load sprite "${sprite}": ${error}`);
        }
      })
    );
  },
};
