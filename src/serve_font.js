"use strict";

import path from "node:path";
import express from "express";
import { getFontsPbf, printLog, getUrl, validatePBFFont } from "./utils.js";

export const serve_font = {
  init: async (config) => {
    const app = express();
    const fontPath = config.options.paths.fonts;

    app.get("/:id/:range(\\d{1,5}-\\d{1,5}).pbf", async (req, res, next) => {
      const id = decodeURI(req.params.id);
      const { range = "" } = req.params;

      try {
        const concatenated = await getFontsPbf(fontPath, id, range);

        res.header("Content-type", "application/x-protobuf");

        return res.status(200).send(concatenated);
      } catch (error) {
        printLog("error", `Failed to get font "${id}": ${error}`);

        res.header("Content-Type", "text/plain");

        return res.status(404).send("Font is not found");
      }
    });

    app.get("/fonts.json", async (req, res, next) => {
      const fonts = Object.keys(config.repo.fonts);

      const result = fonts.map((font) => {
        return {
          name: font,
          url: `${getUrl(req)}fonts/${font}/{range}.pbf`,
        };
      });

      res.header("Content-Type", "text/plain");

      return res.status(200).send(result);
    });

    return app;
  },

  remove: (config, id) => {
    delete config.repo.fonts[id];
  },

  add: async (config) => {
    const fontPath = config.options.paths.fonts;
    const fonts = Object.keys(config.fonts);

    await Promise.all(
      fonts.map(async (font) => {
        try {
          /* Validate font */
          const pbfDirPath = path.join(fontPath, font);

          validatePBFFont(pbfDirPath);

          config.repo.fonts[font] = true;
        } catch (error) {
          printLog(
            "error",
            `Failed to load font "${font}": ${error}. Skipping...`
          );
        }
      })
    );
  },
};
