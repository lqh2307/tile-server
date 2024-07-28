"use strict";

import fs from "node:fs";
import path from "node:path";
import express from "express";
import { printLog, getURL, validateSprite } from "./utils.js";

function getSpriteHandler(config) {
  return async (req, res, next) => {
    const id = decodeURI(req.params.id);
    const item = config.repo.sprites[id];

    if (item === undefined) {
      return res.status(404).send("Sprite is not found");
    }

    try {
      const filePath = `${path.join(
        config.options.paths.sprites,
        id,
        "sprite"
      )}${req.params.scale || ""}.${req.params.format}`;

      const data = fs.readFileSync(filePath);

      if (req.params.format === "json") {
        res.header("Content-type", "application/json");
      } else {
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
    return async (req, res, next) => {
      const sprites = config.repo.sprites;

      const result = Object.keys(sprites).map((id) => {
        return {
          name: id,
          urls: [
            `${getURL(req)}sprites/${id}/sprite.json`,
            `${getURL(req)}sprites/${id}/sprite.png`,
          ],
        };
      });

      return res.status(200).send(result);
    };
  };
}

export const serve_sprite = {
  init: (config) => {
    const app = express();

    /* Get all sprites */
    app.get("/sprites.json", getSpritesListHandler(config));

    /* Get sprite */
    app.get(
      "/:id/sprite:scale(@\\d+x)?.:format(json|png)",
      getSpriteHandler(config)
    );

    return app;
  },

  add: async (config) => {
    await Promise.all(
      Object.keys(config.sprites).map(async (id) => {
        try {
          /* Validate sprite */
          const dirPath = path.join(config.options.paths.sprites, id);

          await validateSprite(dirPath);

          /* Add to repo */
          config.repo.sprites[id] = true;
        } catch (error) {
          printLog(
            "error",
            `Failed to load sprite "${id}": ${error}. Skipping...`
          );
        }
      })
    );
  },
};
