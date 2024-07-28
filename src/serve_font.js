"use strict";

import zlib from "zlib";
import path from "node:path";
import express from "express";
import { validateFont, getFontsPBF, printLog, getURL } from "./utils.js";

function getFontHandler(config) {
  return async (req, res, next) => {
    const ids = decodeURI(req.params.id);

    try {
      let data = await getFontsPBF(
        config.options.paths.fonts,
        ids,
        req.params.range
      );

      /* Gzip pbf font */
      if (data[0] !== 0x1f && data[1] !== 0x8b) {
        data = zlib.gzipSync(data);

        res.header("Content-Encoding", "gzip");
      }

      res.header("Content-Type", "application/x-protobuf");

      return res.status(200).send(data);
    } catch (error) {
      printLog("error", `Failed to get font "${ids}": ${error}`);

      return res.status(404).send("Font is not found");
    }
  };
}

function getFontsListHandler(config) {
  return async (req, res, next) => {
    const result = Object.keys(config.repo.fonts).map((id) => {
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
