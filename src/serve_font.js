"use strict";

import path from "node:path";
import express from "express";
import { getFontsPbf, printLog, getUrl, validatePBFFont } from "./utils.js";

function getFontHandler(getConfig) {
  return async (req, res, next) => {
    const config = getConfig();
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

      res.header("Content-Type", "text/plain");

      return res.status(404).send("Font is not found");
    }
  };
}

function getFontsListHandler(getConfig) {
  return async (req, res, next) => {
    const config = getConfig();
    const fonts = Object.keys(config.repo.fonts);

    const result = fonts.map((font) => {
      return {
        name: font,
        url: `${getUrl(req)}fonts/${font}/{range}.pbf`,
      };
    });

    res.header("Content-Type", "text/plain");

    return res.status(200).send(result);
  };
}

export const serve_font = {
  init: (getConfig) => {
    const app = express();

    app.get("/fonts.json", getFontsListHandler(getConfig));

    app.get("/:id/:range(\\d{1,5}-\\d{1,5}).pbf", getFontHandler(getConfig));

    return app;
  },

  remove: async (config) => {
    config.repo.fonts = {};
  },

  add: async (config) => {
    const fonts = Object.keys(config.fonts);

    await Promise.all(
      fonts.map(async (font) => {
        try {
          /* Validate font */
          validatePBFFont(path.join(config.options.paths.fonts, font));

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
