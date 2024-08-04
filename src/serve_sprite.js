"use strict";

import { printLog, getRequestHost, validateSprite } from "./utils.js";
import { StatusCodes } from "http-status-codes";
import fs from "node:fs/promises";
import express from "express";
import path from "node:path";

function getSpriteHandler(config) {
  return async (req, res, next) => {
    const id = decodeURI(req.params.id);
    const item = config.repo.sprites[id];

    if (item === undefined) {
      return res.status(StatusCodes.NOT_FOUND).send("Sprite is not found");
    }

    try {
      const filePath = `${path.join(
        config.options.paths.sprites,
        id,
        "sprite"
      )}${req.params.scale || ""}.${req.params.format}`;

      const data = await fs.readFile(filePath);

      if (req.params.format === "json") {
        res.header("Content-Type", "application/json");
      } else {
        res.header("Content-Type", "image/png");
      }

      return res.status(StatusCodes.OK).send(data);
    } catch (error) {
      printLog("error", `Failed to get sprite "${id}": ${error}`);

      return res
        .status(StatusCodes.INTERNAL_SERVER_ERROR)
        .send("Internal server error");
    }
  };
}

function getSpritesListHandler(config) {
  return async (req, res, next) => {
    try {
      const result = Object.keys(config.repo.sprites).map((id) => {
        return {
          name: id,
          urls: [
            `${getRequestHost(req)}sprites/${id}/sprite.json`,
            `${getRequestHost(req)}sprites/${id}/sprite.png`,
          ],
        };
      });

      return res.status(StatusCodes.OK).send(result);
    } catch (error) {
      printLog("error", `Failed to get sprites": ${error}`);

      return res
        .status(StatusCodes.INTERNAL_SERVER_ERROR)
        .send("Internal server error");
    }
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
