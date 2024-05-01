"use strict";

import express from "express";
import { getFontsPbf, listFonts } from "./utils.js";

export const serve_font = async (options, allowedFonts) => {
  const app = express().disable("x-powered-by");

  const lastModified = new Date().toUTCString();
  const fontPath = options.paths.fonts;
  const existingFonts = Object.assign({}, listFonts(options.paths.fonts));

  app.get("/:fontstack/:range([\\d]+-[\\d]+).pbf", async (req, res, next) => {
    const fontstack = decodeURI(req.params.fontstack);
    const range = req.params.range;

    try {
      const concatenated = await getFontsPbf(
        null,
        fontPath,
        fontstack,
        range,
        existingFonts
      );

      res.header("Content-type", "application/x-protobuf");
      res.header("Last-Modified", lastModified);

      return res.send(concatenated);
    } catch (err) {
      res.status(400).header("Content-Type", "text/plain").send(err.message);
    }
  });

  app.get("/fonts.json", (req, res, next) => {
    res.header("Content-type", "application/json");
    return res.send(Object.keys(existingFonts));
  });

  return app;
};
