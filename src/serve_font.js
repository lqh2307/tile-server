"use strict";

import path from "node:path";
import express from "express";
import { validatePBFFont, getFontsPbf, printLog, getUrl } from "./utils.js";

function getFontHandler(config) {
  return async (req, res, next) => {
    const id = decodeURI(req.params.id);

    try {
      const concatenated = await getFontsPbf(
        config.options.paths.fonts,
        id,
        req.params.range
      );

      res.header("Content-type", "application/x-protobuf");

      return res.status(200).send(concatenated);
    } catch (error) {
      printLog("error", `Failed to get font "${id}": ${error}`);

      return res.status(404).send("Font is not found");
    }
  };
}

function getFontsListHandler(config) {
  return async (req, res, next) => {
    const fonts = config.repo.fonts;

    const result = Object.keys(fonts).map((font) => {
      return {
        name: font,
        url: `${getUrl(req)}fonts/${font}/{range}.pbf`,
      };
    });

    return res.status(200).send(result);
  };
}

export const serve_font = {
  init: (config) => {
    const app = express();

    app.get("/fonts.json", getFontsListHandler(config));
    app.get("/:id/:range(\\d{1,5}-\\d{1,5}).pbf", getFontHandler(config));

    return app;
  },

  add: async (config) => {
    await Promise.all(
      Object.keys(config.fonts).map(async (font) => {
        try {
          /* Validate font */
          const dirPath = path.join(config.options.paths.fonts, font);

          validatePBFFont(dirPath);

          /* Add to repo */
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
