"use strict";

import fs from "node:fs";
import path from "node:path";
import express from "express";
import { printLog, getUrl, validateSprite } from "./utils.js";

function getSpriteHandler(config) {
  return async (req, res, next) => {
    const id = decodeURI(req.params.id);
    const item = config.repo.sprites[id];

    if (!item) {
      return res.status(404).send("Sprite is not found");
    }

    const filePath = `${path.join(config.options.paths.sprites, id, "sprite")}${req.params.scale || ""}.${req.params.format}`;

    try {
      const data = fs.readFileSync(filePath);

      if (req.params.format === "json") {
        res.header("Content-type", "application/json");
      } else if (req.params.format === "png") {
        res.header("Content-type", "image/png");
      }

      return res.status(200).send(data);
    } catch (error) {
      printLog("error", `Failed to get sprite "${id}": ${error}`);

      return res.status(404).send("Sprite is not found");
    }
  };
}

function getSpritesListHandler(config) {
  return async (req, res, next) => {
    const sprites = config.repo.sprites;

    const result = Object.keys(sprites).map((sprite) => {
      return {
        name: sprite,
        urls: [
          `${getUrl(req)}sprites/${sprite}/sprite.json`,
          `${getUrl(req)}sprites/${sprite}/sprite.png`,
        ],
      };
    });

    return res.status(200).send(result);
  };
}

export const serve_sprite = {
  init: (config) => {
    const app = express();

    app.get("/sprites.json", getSpritesListHandler(config));
    app.get(
      "/:id/sprite:scale(@\\d+x)?.:format(png|json)",
      getSpriteHandler(config)
    );

    return app;
  },

  add: async (config) => {
    await Promise.all(
      Object.keys(config.sprites).map(async (sprite) => {
        try {
          /* Validate sprite */
          const dirPath = path.join(config.options.paths.sprites, sprite);

          validateSprite(dirPath);

          config.repo.sprites[sprite] = true;
        } catch (error) {
          printLog(
            "error",
            `Failed to load sprite "${sprite}": ${error}. Skipping...`
          );
        }
      })
    );
  },
};
