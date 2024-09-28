"use strict";

import { StatusCodes } from "http-status-codes";
import swaggerUi from "swagger-ui-express";
import fsPromise from "node:fs/promises";
import swaggerJsdoc from "swagger-jsdoc";
import { printLog } from "./utils.js";
import { config } from "./config.js";
import express from "express";

function serveSwagger() {
  return (req, res, next) => {
    swaggerUi.setup(
      swaggerJsdoc({
        swaggerDefinition: {
          openapi: "3.0.0",
          info: {
            title: "Tile Server API",
            version: "1.0.0",
            description: "API for tile server",
          },
        },
        apis: ["src/*.js"],
      })
    )(req, res, next);
  };
}

function serveInfoHandler() {
  return async (req, res, next) => {
    try {
      if (config.startupComplete === false) {
        return res.status(StatusCodes.SERVICE_UNAVAILABLE).send("Starting...");
      }

      const result = {
        version: JSON.parse(await fsPromise.readFile("package.json", "utf8"))
          .version,
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
        },
        style: {
          count: 0,
          size: 0,
        },
        rendered: {
          count: Object.keys(config.repo.rendereds).length,
        },
      };

      for (const font in config.repo.fonts) {
        const dirPath = `${config.paths.fonts}/${font}`;
        const fileNames = await fsPromise.readdir(dirPath);

        result.font.count += 1;

        for (const fileName of fileNames) {
          const filePath = `${dirPath}/${fileName}`;
          const stat = await fsPromise.stat(filePath);

          if (
            /^\d{1,5}-\d{1,5}\.pbf$/.test(fileName) === true &&
            stat.isFile() === true
          ) {
            result.font.size += stat.size;
          }
        }
      }

      for (const sprite in config.repo.sprites) {
        const dirPath = `${config.paths.sprites}/${sprite}`;
        const fileNames = await fsPromise.readdir(dirPath);

        result.sprite.count += 1;

        for (const fileName of fileNames) {
          const filePath = `${dirPath}/${fileName}`;
          const stat = await fsPromise.stat(filePath);

          if (
            /^sprite(@\d+x)?\.(json|png)$/.test(fileName) === true &&
            stat.isFile() === true
          ) {
            result.sprite.size += stat.size;
          }
        }
      }

      for (const data in config.repo.datas) {
        if (config.repo.datas[data].sourceType === "mbtiles") {
          const filePath = `${config.paths.mbtiles}/${config.data[data].mbtiles}`;
          const stat = await fsPromise.stat(filePath);

          result.data.mbtiles.count += 1;
          result.data.mbtiles.size += stat.size;
        } else {
          result.data.pmtiles.count += 1;

          if (
            config.data[data].pmtiles.startsWith("https://") !== true &&
            config.data[data].pmtiles.startsWith("http://") !== true
          ) {
            const filePath = `${config.paths.pmtiles}/${config.data[data].pmtiles}`;
            const stat = await fsPromise.stat(filePath);

            result.data.pmtiles.size += stat.size;
          }
        }
      }

      result.data.count = result.data.mbtiles.count + result.data.pmtiles.count;
      result.data.size = result.data.mbtiles.size + result.data.pmtiles.size;

      for (const style in config.repo.styles) {
        const filePath = `${config.paths.styles}/${config.styles[style].style}`;
        const stat = await fsPromise.stat(filePath);

        result.style.count += 1;
        result.style.size += stat.size;
      }

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
      if (config.startupComplete === false) {
        return res.status(StatusCodes.SERVICE_UNAVAILABLE).send("Starting...");
      }

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
        process.kill(Number(process.env.MAIN_PID), "SIGTERM");
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
        process.kill(Number(process.env.MAIN_PID), "SIGINT");
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
     * /health:
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
    app.get("/info", serveInfoHandler());

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
