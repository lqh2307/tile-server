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
            version: "0.0.1",
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
        await fsPromise.readFile(config.paths.config, "utf8")
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
        await fsPromise.readFile(config.paths.seed, "utf8")
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
        await fsPromise.readFile(config.paths.cleanUp, "utf8")
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

function serveInfoHandler() {
  return async (req, res, next) => {
    try {
      // Read package.json file
      const packageJSON = JSON.parse(
        await fsPromise.readFile("package.json", "utf8")
      );

      // Init info
      const result = {
        name: packageJSON.name,
        version: packageJSON.version,
        description: packageJSON.description,
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
        const dirPath = `${config.paths.fonts}/${font}`;
        const fileNames = await findFiles(
          dirPath,
          /^\d{1,5}-\d{1,5}\.pbf$/,
          true
        );

        result.font.count += 1;

        for (const fileName of fileNames) {
          const filePath = `${dirPath}/${fileName}`;
          const stat = await fsPromise.stat(filePath);

          result.font.size += stat.size;
        }
      }

      // Sprites info
      for (const sprite in config.repo.sprites) {
        const dirPath = `${config.paths.sprites}/${sprite}`;
        const fileNames = await findFiles(
          dirPath,
          /^sprite(@\d+x)?\.(json|png)$/,
          true
        );

        result.sprite.count += 1;

        for (const fileName of fileNames) {
          const filePath = `${dirPath}/${fileName}`;
          const stat = await fsPromise.stat(filePath);

          result.sprite.size += stat.size;
        }
      }

      // Datas info
      for (const data in config.repo.datas) {
        if (config.repo.datas[data].sourceType === "mbtiles") {
          const filePath = `${config.paths.mbtiles}/${config.datas[data].mbtiles}`;
          const stat = await fsPromise.stat(filePath);

          result.data.mbtiles.count += 1;
          result.data.mbtiles.size += stat.size;
        } else if (config.repo.datas[data].sourceType === "pmtiles") {
          result.data.pmtiles.count += 1;

          if (
            config.datas[data].pmtiles.startsWith("https://") !== true &&
            config.datas[data].pmtiles.startsWith("http://") !== true
          ) {
            const filePath = `${config.paths.pmtiles}/${config.datas[data].pmtiles}`;
            const stat = await fsPromise.stat(filePath);

            result.data.pmtiles.size += stat.size;
          }
        } else if (config.repo.datas[data].sourceType === "xyz") {
          const fileNames = await findFiles(
            config.repo.datas[data].source,
            /^\d+\.(gif|png|jpg|jpeg|webp|pbf)$/,
            true
          );

          result.data.xyz.count += 1;

          for (const fileName of fileNames) {
            const filePath = `${config.repo.datas[data].source}/${fileName}`;
            const stat = await fsPromise.stat(filePath);

            result.data.xyz.size += stat.size;
          }
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
      for (const style in config.repo.styles) {
        const filePath = `${config.paths.styles}/${config.styles[style].style}`;
        const stat = await fsPromise.stat(filePath);

        result.style.count += 1;
        result.style.size += stat.size;
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
      setTimeout(async () => {
        await restartServer();
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
      setTimeout(async () => {
        await killServer();
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
