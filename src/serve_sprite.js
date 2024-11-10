"use strict";

import { StatusCodes } from "http-status-codes";
import fsPromise from "node:fs/promises";
import { printLog } from "./logger.js";
import { config } from "./config.js";
import express from "express";
import sharp from "sharp";
import {
  getRequestHost,
  validateSprite,
  getSprite,
  findFiles,
} from "./utils.js";

/**
 * Validate sprite
 * @param {string} spriteDirPath Sprite dir path
 * @returns {Promise<void>}
 */
async function validateSprite(spriteDirPath) {
  const [jsonSpriteFileNames, pngSpriteNames] = await Promise.all([
    findFiles(spriteDirPath, /^sprite(@\d+x)?\.json$/, false),
    findFiles(spriteDirPath, /^sprite(@\d+x)?\.png$/, false),
  ]);

  if (jsonSpriteFileNames.length !== pngSpriteNames.length) {
    throw new Error("Missing some JSON or PNG files");
  }

  const fileNameWoExts = jsonSpriteFileNames.map(
    (jsonSpriteFileName) => jsonSpriteFileName.split(".")[0]
  );

  await Promise.all(
    fileNameWoExts.map(async (fileNameWoExt) => {
      /* Validate JSON sprite */
      const fileData = await fsPromise.readFile(
        `${spriteDirPath}/${fileNameWoExt}.json`,
        "utf8"
      );

      Object.values(JSON.parse(fileData)).forEach((value) => {
        if (
          typeof value !== "object" ||
          "height" in value === false ||
          "pixelRatio" in value === false ||
          "width" in value === false ||
          "x" in value === false ||
          "y" in value === false
        ) {
          throw new Error("Invalid JSON file");
        }
      });

      /* Validate PNG sprite */
      const pngMetadata = await sharp(
        `${spriteDirPath}/${fileNameWoExt}.png`
      ).metadata();

      if (pngMetadata.format !== "png") {
        throw new Error("Invalid PNG file");
      }
    })
  );
}

function getSpriteHandler() {
  return async (req, res, next) => {
    const id = req.params.id;
    const item = config.repo.sprites[id];

    if (item === undefined) {
      return res.status(StatusCodes.NOT_FOUND).send("Sprite is not found");
    }

    try {
      const data = await getSprite(
        id,
        req.url.slice(req.url.lastIndexOf("/") + 1)
      );

      if (req.params.format === "json") {
        res.header("Content-Type", "application/json");
      } else {
        res.header("Content-Type", "image/png");
      }

      return res.status(StatusCodes.OK).send(data);
    } catch (error) {
      printLog("error", `Failed to get sprite "${id}": ${error}`);

      return res
        .status(StatusCodes.INTERNAL_SERVER_ERROR)
        .send("Internal server error");
    }
  };
}

function getSpritesListHandler() {
  return async (req, res, next) => {
    try {
      const result = await Promise.all(
        Object.keys(config.repo.sprites).map(async (id) => {
          return {
            name: id,
            urls: [
              `${getRequestHost(req)}sprites/${id}/sprite.json`,
              `${getRequestHost(req)}sprites/${id}/sprite.png`,
            ],
          };
        })
      );

      return res.status(StatusCodes.OK).send(result);
    } catch (error) {
      printLog("error", `Failed to get sprites": ${error}`);

      return res
        .status(StatusCodes.INTERNAL_SERVER_ERROR)
        .send("Internal server error");
    }
  };
}

export const serve_sprite = {
  init: () => {
    const app = express();

    /**
     * @swagger
     * tags:
     *   - name: Sprite
     *     description: Sprite related endpoints
     * /sprites/sprites.json:
     *   get:
     *     tags:
     *       - Sprite
     *     summary: Get all sprites
     *     responses:
     *       200:
     *         description: List of all sprites
     *         content:
     *           application/json:
     *             schema:
     *               type: array
     *               items:
     *                 type: object
     *                 properties:
     *                   name:
     *                     type: string
     *                   urls:
     *                     type: array
     *                     items:
     *                       type: string
     *       404:
     *         description: Not found
     *       503:
     *         description: Server is starting up
     *         content:
     *           text/plain:
     *             schema:
     *               type: string
     *               example: Starting...
     *       500:
     *         description: Internal server error
     */
    app.get("/sprites.json", getSpritesListHandler());

    /**
     * @swagger
     * tags:
     *   - name: Sprite
     *     description: Sprite related endpoints
     * /sprites/{id}/sprite{scale}.{format}:
     *   get:
     *     tags:
     *       - Sprite
     *     summary: Get sprite
     *     parameters:
     *       - in: path
     *         name: id
     *         schema:
     *           type: string
     *         required: true
     *         description: ID of the sprite
     *       - in: path
     *         name: scale
     *         schema:
     *           type: string
     *         required: false
     *         description: Scale of the sprite (e.g., @2x)
     *       - in: path
     *         name: format
     *         schema:
     *           type: string
     *           enum: [json, png]
     *         required: true
     *         description: Format of the sprite
     *     responses:
     *       200:
     *         description: Sprite
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *           image/png:
     *             schema:
     *               type: string
     *               format: binary
     *       404:
     *         description: Not found
     *       503:
     *         description: Server is starting up
     *         content:
     *           text/plain:
     *             schema:
     *               type: string
     *               example: Starting...
     *       500:
     *         description: Internal server error
     */
    app.get("/:id/sprite:scale(@\\d+x)?.:format(json|png)", getSpriteHandler());

    return app;
  },

  add: async () => {
    await Promise.all(
      Object.keys(config.sprites).map(async (id) => {
        try {
          /* Validate sprite */
          const dirPath = `${config.paths.sprites}/${id}`;

          await validateSprite(dirPath);

          /* Add to repo */
          config.repo.sprites[id] = true;
        } catch (error) {
          printLog(
            "error",
            `Failed to load sprite "${id}": ${error}. Skipping...`
          );
        }
      })
    );
  },
};
