"use strict";

import path from "node:path";
import express from "express";
import { getFontsPbf, printLog, findFiles, getUrl } from "./utils.js";

export const serve_font = {
  init: async (config, repo) => {
    const app = express().disable("x-powered-by");
    const lastModified = new Date().toUTCString();
    const fontPath = config.options.paths.fonts;

    app.get("/:id/:range(\\d{1,5}-\\d{1,5}).pbf", async (req, res, next) => {
      const id = decodeURI(req.params.id);
      const { range = "" } = req.params;

      try {
        const concatenated = await getFontsPbf(fontPath, id, range);

        res.header("Content-type", "application/x-protobuf");
        res.header("Last-Modified", lastModified);

        return res.status(200).send(concatenated);
      } catch (err) {
        printLog("error", `Failed to get font ${id}: ${err.message}`);

        res.header("Content-Type", "text/plain");

        return res.status(404).send("Font is not found");
      }
    });

    app.get("/fonts.json", async (req, res, next) => {
      const result = Object.keys(repo).map((font) => {
        return {
          name: font,
          url: `${getUrl(req)}fonts/${font}/{range}.pbf`,
        };
      });

      res.header("Content-Type", "text/plain");
      res.header("Last-Modified", lastModified);

      return res.status(200).send(result);
    });

    return app;
  },

  remove: (repo, id) => {
    delete repo[id];
  },

  add: async (config, repo) => {
    const fontPath = config.options.paths.fonts;
    const fontstacks = Object.keys(config.fonts);
    const fallbackFont = "Open Sans Regular";

    if (!fontstacks.includes(fallbackFont)) {
      throw Error(`Fallback font "${fallbackFont}" is not found`);
    }

    await Promise.all(
      fontstacks.map(async (font) => {
        try {
          /* Validate font */
          const dirPath = path.join(fontPath, font);

          const fileNames = findFiles(dirPath, /^\d{1,5}-\d{1,5}\.pbf{1}$/);

          if (fileNames.length == 256) {
            repo[font] = true;
          } else {
            throw Error(`Font "${font}" is invalid`);
          }
        } catch (error) {
          printLog("error", `Failed to load fonts: ${error.message}`);
        }
      })
    );

    return true;
  },
};
