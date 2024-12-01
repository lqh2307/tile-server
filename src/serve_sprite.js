"use strict";

import { getSprite, validateSprite } from "./sprite.js";
import { checkReadyMiddleware } from "./middleware.js";
import { StatusCodes } from "http-status-codes";
import { getRequestHost } from "./utils.js";
import { printLog } from "./logger.js";
import { config } from "./config.js";
import express from "express";

/**
 * Get sprite handler
 * @returns {(req: any, res: any, next: any) => Promise<any>}
 */
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
        res.header("content-type", "application/json");
      } else {
        res.header("content-type", "image/png");
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

/**
 * Get sprite list handler
 * @returns {(req: any, res: any, next: any) => Promise<any>}
 */
function getSpritesListHandler() {
  return async (req, res, next) => {
    try {
      const result = await Promise.all(
        Object.keys(config.repo.sprites).map(async (id) => {
          return {
            name: id,
            urls: [
              `${getRequestHost(req)}/sprites/${id}/sprite.json`,
              `${getRequestHost(req)}/sprites/${id}/sprite.png`,
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
    const app = express().disable('x-powered-by');

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
    app.get("/sprites.json", checkReadyMiddleware(), getSpritesListHandler());

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
     *           example: id
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
     *           example: json
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
    app.get(
      "/:id/sprite:scale(@\\d+x)?.:format(json|png)",
      checkReadyMiddleware(),
      getSpriteHandler()
    );

    return app;
  },

  add: async () => {
    await Promise.all(
      Object.keys(config.sprites).map(async (id) => {
        try {
          /* Validate sprite */
          const dirPath = `${process.env.DATA_DIR}/sprites/${id}`;

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
