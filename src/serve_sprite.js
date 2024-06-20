"use strict";

import fs from "node:fs";
import path from "node:path";
import express from "express";
import { printLog, getUrl, validateSprite } from "./utils.js";

function getSpriteHandler(getConfig) {
  return async (req, res, next) => {
    const config = getConfig();
    const id = decodeURI(req.params.id);
    const item = config.repo.sprites[id];

    try {
      if (!item) {
        throw Error("Sprite is not found");
      }

      const format = req.params.format || "";

      const data = fs.readFileSync(
        `${path.join(config.options.paths.sprites, id, "sprite")}${req.params.scale || ""}.${format}`
      );

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
  };
}

function getSpritesListHandler(getConfig) {
  return async (req, res, next) => {
    const config = getConfig();
    const sprites = Object.keys(config.repo.sprites);

    const result = sprites.map((sprite) => {
      return {
        name: sprite,
        url: `${getUrl(req)}sprites/${sprite}/sprite`,
      };
    });

    res.header("Content-Type", "text/plain");

    return res.status(200).send(result);
  };
}

export const serve_sprite = {
  init: (getConfig) => {
    const app = express();

    app.get(
      "/:id/sprite:scale(@\\d+x)?.:format((png|json){1})",
      getSpriteHandler(getConfig)
    );

    app.get("/sprites.json", getSpritesListHandler(getConfig));

    return app;
  },

  remove: async (config) => {
    config.repo.sprites = {};
  },

  add: async (config) => {
    const sprites = Object.keys(config.sprites);

    await Promise.all(
      sprites.map(async (sprite) => {
        try {
          /* Validate sprite */
          validateSprite(path.join(config.options.paths.sprites, sprite));

          config.repo.sprites[sprite] = true;
        } catch (error) {
          printLog("error", `Failed to load sprite "${sprite}": ${error}`);
        }
      })
    );
  },
};
