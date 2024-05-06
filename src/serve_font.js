"use strict";

import path from "node:path";
import express from "express";
import { getFontsPbf, printLog, findFiles, getUrl } from "./utils.js";

export const serve_font = {
  init: (config, repo) => {
    const app = express().disable("x-powered-by");
    const lastModified = new Date().toUTCString();
    const fontPath = config.options.paths.fonts;

    app.get("/:fontstack/:range([\\d]+-[\\d]+).pbf", async (req, res, next) => {
      const fontstack = decodeURI(req.params.fontstack);
      const { range = "" } = req.params;

      try {
        const concatenated = await getFontsPbf(fontPath, fontstack, range);

        res.header("Content-type", "application/x-protobuf");
        res.header("Last-Modified", lastModified);

        return res.status(200).send(concatenated);
      } catch (err) {
        printLog("error", `Failed to get font: ${err.message}`);

        res.header("Content-Type", "text/plain");

        return res.status(400).send(err.message);
      }
    });

    app.get("/fonts.json", (req, res, next) => {
      const results = [];

      for (const fontstack of Object.keys(repo)) {
        results.push({
          name: fontstack,
          url: `${getUrl(req)}fonts/${fontstack}/{range}.pbf`,
        });
      }

      res.header("Content-Type", "text/plain");
      res.header("Last-Modified", lastModified);

      return res.status(200).send(results);
    });

    return app;
  },

  remove: (repo, fontstack) => {
    delete repo[fontstack];
  },

  add: async (config, repo) => {
    const fontPath = config.options.paths.fonts;
    const fontstacks = Object.keys(config.fonts);
    const fallbackFont = "Open Sans Regular";

    try {
      if (!fontstacks.includes(fallbackFont)) {
        throw Error(`Fallback font "${fallbackFont}" is not found`);
      }

      for (const fontstack of fontstacks) {
        /* Validate font */
        const fileNames = await findFiles(
          path.join(fontPath, fontstack),
          /^\d{1,5}-\d{1,5}\.pbf{1}$/
        );

        if (fileNames.length == 256) {
          repo[fontstack] = true;
        } else {
          throw Error(`Font "${fontstack}" is invalid`);
        }
      }
    } catch (err) {
      printLog("error", `Failed to load fonts: ${err.message}`);

      process.exit(1);
    }

    return true;
  },
};
