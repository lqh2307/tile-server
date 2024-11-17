"use strict";

import { StatusCodes } from "http-status-codes";
import swaggerUi from "swagger-ui-express";
import fsPromise from "node:fs/promises";
import swaggerJsdoc from "swagger-jsdoc";
import { printLog } from "./logger.js";
import { config } from "./config.js";
import express from "express";
import {
  checkReadyMiddleware,
  restartServer,
  killServer,
  getVersion,
  findFiles,
} from "./utils.js";

function serveSwagger() {
  return (req, res, next) => {
    swaggerUi.setup(
      swaggerJsdoc({
        swaggerDefinition: {
          openapi: "3.0.0",
          info: {
            title: "Tile Server API",
            version: getVersion(),
            description: "API for tile server",
          },
        },
        apis: ["src/*.js"],
      })
    )(req, res, next);
  };
}

function serveConfigHandler() {
  return async (req, res, next) => {
    try {
      const configJSON = JSON.parse(
        await fsPromise.readFile(`${process.env.DATA_DIR}/config.json`, "utf8")
      );

      res.header("Content-Type", "application/json");

      return res.status(StatusCodes.OK).send(configJSON);
    } catch (error) {
      printLog("error", `Failed to get config": ${error}`);

      return res
        .status(StatusCodes.INTERNAL_SERVER_ERROR)
        .send("Internal server error");
    }
  };
}

function serveSeedHandler() {
  return async (req, res, next) => {
    try {
      const seedJSON = JSON.parse(
        await fsPromise.readFile(`${process.env.DATA_DIR}/seed.json`, "utf8")
      );

      res.header("Content-Type", "application/json");

      return res.status(StatusCodes.OK).send(seedJSON);
    } catch (error) {
      printLog("error", `Failed to get seed": ${error}`);

      return res
        .status(StatusCodes.INTERNAL_SERVER_ERROR)
        .send("Internal server error");
    }
  };
}

function serveCleanUpHandler() {
  return async (req, res, next) => {
    try {
      const cleanUpJSON = JSON.parse(
        await fsPromise.readFile(`${process.env.DATA_DIR}/cleanup.json`, "utf8")
      );

      res.header("Content-Type", "application/json");

      return res.status(StatusCodes.OK).send(cleanUpJSON);
    } catch (error) {
      printLog("error", `Failed to get clean up": ${error}`);

      return res
        .status(StatusCodes.INTERNAL_SERVER_ERROR)
        .send("Internal server error");
    }
  };
}

function serveSummaryHandler() {
  return async (req, res, next) => {
    try {
      // Init info
      const result = {
        font: {
          count: 0,
          size: 0,
        },
        sprite: {
          count: 0,
          size: 0,
        },
        data: {
          count: 0,
          size: 0,
          mbtiles: {
            count: 0,
            size: 0,
          },
          pmtiles: {
            count: 0,
            size: 0,
          },
          xyz: {
            count: 0,
            size: 0,
          },
        },
        style: {
          count: 0,
          size: 0,
        },
        rendered: {
          count: 0,
        },
      };

      // Fonts info
      for (const font in config.repo.fonts) {
        const dirPath = `${process.env.DATA_DIR}/fonts/${font}`;
        const fileNames = await findFiles(
          dirPath,
          /^\d{1,5}-\d{1,5}\.pbf$/,
          true
        );

        result.font.count += 1;

        for (const fileName of fileNames) {
          const stat = await fsPromise.stat(`${dirPath}/${fileName}`);

          result.font.size += stat.size;
        }
      }

      // Sprites info
      for (const sprite in config.repo.sprites) {
        const dirPath = `${process.env.DATA_DIR}/sprites/${sprite}`;
        const fileNames = await findFiles(
          dirPath,
          /^sprite(@\d+x)?\.(json|png)$/,
          true
        );

        result.sprite.count += 1;

        for (const fileName of fileNames) {
          const stat = await fsPromise.stat(`${dirPath}/${fileName}`);

          result.sprite.size += stat.size;
        }
      }

      // Datas info
      for (const id in config.repo.datas) {
        const item = config.repo.datas[id];

        if (item.sourceType === "mbtiles") {
          const stat = await fsPromise.stat(item.path);

          result.data.mbtiles.size += stat.size;
          result.data.mbtiles.count += 1;
        } else if (item.sourceType === "pmtiles") {
          if (
            item.path.startsWith("https://") !== true &&
            item.path.startsWith("http://") !== true
          ) {
            const stat = await fsPromise.stat(item.path);

            result.data.pmtiles.size += stat.size;
          }

          result.data.pmtiles.count += 1;
        } else if (item.sourceType === "xyz") {
          const fileNames = await findFiles(
            item.path,
            /^\d+\.(gif|png|jpg|jpeg|webp|pbf)$/,
            true
          );

          for (const fileName of fileNames) {
            const stat = await fsPromise.stat(`${item.path}/${fileName}`);

            result.data.xyz.size += stat.size;
          }

          result.data.xyz.count += 1;
        }
      }

      result.data.count =
        result.data.mbtiles.count +
        result.data.pmtiles.count +
        result.data.xyz.count;
      result.data.size =
        result.data.mbtiles.size +
        result.data.pmtiles.size +
        result.data.xyz.size;

      // Styles info
      for (const id in config.repo.styles) {
        const item = config.repo.styles[id];

        try {
          const stat = await fsPromise.stat(item.path);

          result.style.size += stat.size;
        } catch (error) {
          if (
            !(
              item.cache !== undefined &&
              error.message === "Style does not exist"
            )
          ) {
            throw error;
          }
        }

        result.style.count += 1;
      }

      // Rendereds info
      if (config.options.serveRendered === true) {
        result.rendered.count = Object.keys(config.repo.rendereds).length;
      }

      res.header("Content-Type", "application/json");

      return res.status(StatusCodes.OK).send(result);
    } catch (error) {
      printLog("error", `Failed to get info": ${error}`);

      return res
        .status(StatusCodes.INTERNAL_SERVER_ERROR)
        .send("Internal server error");
    }
  };
}

function serveInfoHandler() {
  return async (req, res, next) => {
    try {
      const taskInfo = await fsPromise.readFile(
        `${process.env.DATA_DIR}/server-info.json`,
        "utf8"
      );

      res.header("Content-Type", "application/json");

      return res.status(StatusCodes.OK).send(taskInfo);
    } catch (error) {
      printLog("error", `Failed to get server info": ${error}`);

      return res
        .status(StatusCodes.INTERNAL_SERVER_ERROR)
        .send("Internal server error");
    }
  };
}

function serveHealthHandler() {
  return async (req, res, next) => {
    try {
      return res.status(StatusCodes.OK).send("OK");
    } catch (error) {
      printLog("error", `Failed to check health server": ${error}`);

      return res
        .status(StatusCodes.INTERNAL_SERVER_ERROR)
        .send("Internal server error");
    }
  };
}

function serveRestartHandler() {
  return async (req, res, next) => {
    try {
      setTimeout(() => {
        restartServer().catch(() =>
          printLog("error", `Failed to restart server: ${error}`)
        );
      }, 0);

      return res.status(StatusCodes.OK).send("OK");
    } catch (error) {
      printLog("error", `Failed to restart server": ${error}`);

      return res
        .status(StatusCodes.INTERNAL_SERVER_ERROR)
        .send("Internal server error");
    }
  };
}

function serveKillHandler() {
  return async (req, res, next) => {
    try {
      setTimeout(() => {
        killServer().catch(() =>
          printLog("error", `Failed to kill server: ${error}`)
        );
      }, 0);

      return res.status(StatusCodes.OK).send("OK");
    } catch (error) {
      printLog("error", `Failed to Killing server": ${error}`);

      return res
        .status(StatusCodes.INTERNAL_SERVER_ERROR)
        .send("Internal server error");
    }
  };
}

export const serve_common = {
  init: () => {
    const app = express();

    if (config.options.serveSwagger === true) {
      app.use("/swagger/index.html", swaggerUi.serve, serveSwagger());
    }

    /**
     * @swagger
     * tags:
     *   - name: Common
     *     description: Common related endpoints
     * /info:
     *   get:
     *     tags:
     *       - Common
     *     summary: Get info
     *     responses:
     *       200:
     *         description: Info
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *       400:
     *         description: Bad request
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
    app.get("/info", checkReadyMiddleware(), serveInfoHandler());

    /**
     * @swagger
     * tags:
     *   - name: Common
     *     description: Common related endpoints
     * /summary:
     *   get:
     *     tags:
     *       - Common
     *     summary: Get summary
     *     responses:
     *       200:
     *         description: Summary
     *         content:
     *           application/json:
     *             schema:
     *               type: object
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
    app.get("/summary", checkReadyMiddleware(), serveSummaryHandler());

    /**
     * @swagger
     * tags:
     *   - name: Common
     *     description: Common related endpoints
     * /health:
     *   get:
     *     tags:
     *       - Common
     *     summary: Check health of the server
     *     responses:
     *       200:
     *         description: Server is healthy
     *         content:
     *           text/plain:
     *             schema:
     *               type: string
     *               example: OK
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
    app.get("/health", serveHealthHandler());

    if (config.options.configEndpoint === true) {
      /**
       * @swagger
       * tags:
       *   - name: Common
       *     description: Common related endpoints
       * /restart:
       *   get:
       *     tags:
       *       - Common
       *     summary: Get config
       *     responses:
       *       200:
       *         description: Config
       *         content:
       *           application/json:
       *             schema:
       *               type: object
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
      app.get("/config", serveConfigHandler());

      /**
       * @swagger
       * tags:
       *   - name: Common
       *     description: Common related endpoints
       * /restart:
       *   get:
       *     tags:
       *       - Common
       *     summary: Get seed
       *     responses:
       *       200:
       *         description: Seed
       *         content:
       *           application/json:
       *             schema:
       *               type: object
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
      app.get("/seed", serveSeedHandler());

      /**
       * @swagger
       * tags:
       *   - name: Common
       *     description: Common related endpoints
       * /restart:
       *   get:
       *     tags:
       *       - Common
       *     summary: Get clean up
       *     responses:
       *       200:
       *         description: Clean up
       *         content:
       *           application/json:
       *             schema:
       *               type: object
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
      app.get("/cleanup", serveCleanUpHandler());
    }

    if (config.options.restartEndpoint === true) {
      /**
       * @swagger
       * tags:
       *   - name: Common
       *     description: Common related endpoints
       * /restart:
       *   get:
       *     tags:
       *       - Common
       *     summary: Restart the server
       *     responses:
       *       200:
       *         description: Server will restart
       *         content:
       *           text/plain:
       *             schema:
       *               type: string
       *               example: OK
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
      app.get("/restart", serveRestartHandler());
    }

    if (config.options.killEndpoint === true) {
      /**
       * @swagger
       * tags:
       *   - name: Common
       *     description: Common related endpoints
       * /kill:
       *   get:
       *     tags:
       *       - Common
       *     summary: Kill the server
       *     responses:
       *       200:
       *         description: Server will be killed
       *         content:
       *           text/plain:
       *             schema:
       *               type: string
       *               example: OK
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
      app.get("/kill", serveKillHandler());
    }

    return app;
  },
};
