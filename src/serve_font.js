"use strict";

import path from "node:path";
import express from "express";
import { validateFont, getFontsPBF, printLog, getURL } from "./utils.js";

function getFontHandler(config) {
  return async (req, res, next) => {
    const id = decodeURI(req.params.id);
    const range = req.params.range;

    try {
      const concatenated = await getFontsPBF(
        config.options.paths.fonts,
        id,
        range
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

    const result = Object.keys(fonts).map((id) => {
      return {
        name: id,
        url: `${getURL(req)}fonts/${id}/{range}.pbf`,
      };
    });

    return res.status(200).send(result);
  };
}

export const serve_font = {
  init: (config) => {
    const app = express();

    /* Get all fonts */
    app.get("/fonts.json", getFontsListHandler(config));

    /* Get font */
    app.get("/:id/:range(\\d{1,5}-\\d{1,5}).pbf", getFontHandler(config));

    return app;
  },

  add: async (config) => {
    await Promise.all(
      Object.keys(config.fonts).map(async (id) => {
        try {
          /* Validate font */
          const dirPath = path.join(config.options.paths.fonts, id);

          await validateFont(dirPath);

          /* Add to repo */
          config.repo.fonts[id] = true;
        } catch (error) {
          printLog(
            "error",
            `Failed to load font "${id}": ${error}. Skipping...`
          );
        }
      })
    );
  },
};
