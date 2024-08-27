"use strict";

import { config, folderPaths } from "./config.js";
import { StatusCodes } from "http-status-codes";
import express from "express";
import path from "node:path";
import {
  detectFormatAndHeaders,
  getRequestHost,
  validateFont,
  getFontsPBF,
  gzipAsync,
  printLog,
} from "./utils.js";

function getFontHandler() {
  return async (req, res, next) => {
    const ids = decodeURI(req.params.id);

    try {
      let data = await getFontsPBF(
        ids,
        req.url.slice(req.url.lastIndexOf("/") + 1)
      );

      /* Gzip pbf font */
      const headers = detectFormatAndHeaders(data).headers;
      if (headers["Content-Encoding"] === undefined) {
        data = await gzipAsync(data);

        res.header("Content-Encoding", "gzip");
      }

      res.set(headers);

      return res.status(StatusCodes.OK).send(data);
    } catch (error) {
      printLog("error", `Failed to get font "${ids}": ${error}`);

      return res
        .status(StatusCodes.INTERNAL_SERVER_ERROR)
        .send("Internal server error");
    }
  };
}

function getFontsListHandler() {
  return async (req, res, next) => {
    try {
      const result = Object.keys(config.repo.fonts).map((id) => {
        return {
          name: id,
          url: `${getRequestHost(req)}fonts/${id}/{range}.pbf`,
        };
      });

      return res.status(StatusCodes.OK).send(result);
    } catch (error) {
      printLog("error", `Failed to get fonts": ${error}`);

      return res
        .status(StatusCodes.INTERNAL_SERVER_ERROR)
        .send("Internal server error");
    }
  };
}

export const serve_font = {
  init: () => {
    const app = express();

    /**
     * @swagger
     * tags:
     *   - name: Font
     *     description: Font related endpoints
     * /fonts/fonts.json:
     *   get:
     *     tags:
     *       - Font
     *     summary: Get all fonts
     *     responses:
     *       200:
     *         description: List of fonts
     *         content:
     *           application/json:
     *             schema:
     *               type: array
     *               items:
     *                 type: object
     *                 properties:
     *                   name:
     *                     type: string
     *                   url:
     *                     type: string
     */
    app.get("/fonts.json", getFontsListHandler());

    /**
     * @swagger
     * tags:
     *   - name: Font
     *     description: Font related endpoints
     * /fonts/{id}/{range}.pbf:
     *   get:
     *     tags:
     *       - Font
     *     summary: Get font
     *     parameters:
     *       - in: path
     *         name: id
     *         required: true
     *         schema:
     *           type: string
     *         description: Font ID
     *       - in: path
     *         name: range
     *         required: true
     *         schema:
     *           type: string
     *           pattern: '\\d{1,5}-\\d{1,5}'
     *         description: Font range
     *     responses:
     *       200:
     *         description: Font data
     *         content:
     *           application/octet-stream:
     *             schema:
     *               type: string
     *               format: binary
     */
    app.get("/:id/:range(\\d{1,5}-\\d{1,5}).pbf", getFontHandler());

    return app;
  },

  add: async () => {
    await Promise.all(
      Object.keys(config.fonts).map(async (id) => {
        try {
          /* Validate font */
          const dirPath = path.join(folderPaths.fonts, id);

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
