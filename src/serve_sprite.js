"use strict";

import fs from "node:fs";
import path from "node:path";
import express from "express";
import { printLog, findFiles, getUrl } from "./utils.js";

export const serve_sprite = {
  init: (config, repo) => {
    const app = express().disable("x-powered-by");

    app.get(
      "/:id/sprite?:scale(@[23]x)?.:format([\\w]+)",
      async (req, res, next) => {
        const { id, scale = "", format = "" } = req.params;

        if (format) {
          if (repo[id]) {
            const filePath = `${path.join(config.options.paths.sprites, id, "sprite")}${scale}.${format}`;
            return fs.readFile(filePath, (err, data) => {
              if (err) {
                printLog(
                  "error",
                  `Failed to load sprite id ${id}: ${err.message}`
                );

                return res.sendStatus(404);
              } else {
                if (format === "json") {
                  res.header("Content-type", "application/json");
                } else if (format === "png") {
                  res.header("Content-type", "image/png");
                }

                return res.send(data);
              }
            });
          } else {
            return res.status(400).send("Sprite id or scale is not found");
          }
        } else {
          return res.status(400).send("Sprite format is not found");
        }
      }
    );

    app.get("/sprites.json", (req, res, next) => {
      const result = [];
      for (const id of Object.keys(repo)) {
        result.push({
          id: id,
          url: `${getUrl(req)}sprites/${id}/sprite`,
        });
      }

      return res.send(result);
    });

    return app;
  },

  remove: (repo, id) => {
    delete repo[id];
  },

  add: async (config, repo) => {
    for (const id of Object.keys(config.sprites)) {
      try {
        const fileNames = await findFiles(
          path.join(config.options.paths.sprites, id),
          /^sprite(@(\d+)x)?\.(json|png)/
        );

        if (fileNames.length > 0) {
          repo[id] = {
            name: config.sprites[id],
          };
        }
      } catch (err) {
        printLog("error", `Failed to find sprite: ${err.message}`);
      }
    }

    return true;
  },
};
