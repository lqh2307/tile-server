"use strict";

import fs from "node:fs";
import path from "node:path";
import express from "express";
import {
  printLog,
  findFiles,
  getUrl,
  validateJSONSprite,
  validatePNGSprite,
} from "./utils.js";

export const serve_sprite = {
  init: async (config, repo) => {
    const app = express().disable("x-powered-by");
    const lastModified = new Date().toUTCString();
    const spritePath = config.options.paths.sprites;

    app.get(
      "/:id/sprite:scale(@\\d+x)?.:format((png|json){1})",
      async (req, res, next) => {
        const id = decodeURI(req.params.id);
        const { scale = "", format = "" } = req.params;

        try {
          if (!repo.sprites[id]) {
            throw Error("Sprite is not found");
          }

          const filePath = `${path.join(spritePath, id, "sprite")}${scale}.${format}`;

          const data = fs.readFileSync(filePath);

          if (format === "json") {
            res.header("Content-type", "application/json");
          } else if (format === "png") {
            res.header("Content-type", "image/png");
          }

          res.header("Last-Modified", lastModified);

          return res.status(200).send(data);
        } catch (err) {
          printLog("error", `Failed to get sprite "${id}": ${err.message}`);

          res.header("Content-Type", "text/plain");

          return res.status(404).send("Sprite is not found");
        }
      }
    );

    app.get("/sprites.json", async (req, res, next) => {
      const result = Object.keys(repo.sprites).map((sprite) => {
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
    delete repo.sprites[id];
  },

  add: async (config, repo) => {
    const spritePath = config.options.paths.sprites;
    const sprites = Object.keys(config.sprites);

    await Promise.all(
      sprites.map(async (sprite) => {
        try {
          /* Validate sprite */
          const dirPath = path.join(spritePath, sprite);
          const spritePattern = /^sprite(@\d+x)?\.(png|json){1}$/;

          const fileNameWoExts = [
            ...new Set(
              findFiles(dirPath, spritePattern).map((fileName) =>
                path.basename(fileName, path.extname(fileName))
              )
            ),
          ];

          if (fileNameWoExts.length === 0) {
            throw Error(`Sprite is empty`);
          }

          fileNameWoExts.forEach((fileNameWoExt) => {
            const jsonFilePath = path.join(dirPath, `${fileNameWoExt}.json`);
            const pngFilePath = path.join(dirPath, `${fileNameWoExt}.png`);

            validateJSONSprite(jsonFilePath);
            validatePNGSprite(pngFilePath);
          });

          repo.sprites[sprite] = true;
        } catch (error) {
          printLog(
            "error",
            `Failed to load sprite "${sprite}": ${error.message}`
          );
        }
      })
    );

    return true;
  },
};
