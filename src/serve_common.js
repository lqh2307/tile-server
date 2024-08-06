"use strict";

import { StatusCodes } from "http-status-codes";
import swaggerUi from "swagger-ui-express";
import swaggerJsdoc from "swagger-jsdoc";
import { printLog } from "./utils.js";
import express from "express";

let swaggerSpec;

function serveSwagger() {
  return (req, res, next) => {
    if (!swaggerSpec) {
      swaggerSpec = swaggerJsdoc({
        swaggerDefinition: {
          openapi: "3.0.0",
          info: {
            title: "Tile Server API",
            version: "1.0.0",
            description: "API for tile server",
          },
        },
        apis: ["src/*.js"],
      });
    }

    swaggerUi.setup(swaggerSpec)(req, res, next);
  };
}

function serveHealthHandler(config) {
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
      printLog("info", "Received restart request. Restarting server...");

      setTimeout(() => {
        process.exit(1);
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
      printLog("info", "Received kill request. Killed server!");

      setTimeout(() => {
        process.exit(0);
      }, 0);

      return res.status(StatusCodes.OK).send("OK");
    } catch (error) {
      printLog("error", `Failed to kill server": ${error}`);

      return res
        .status(StatusCodes.INTERNAL_SERVER_ERROR)
        .send("Internal server error");
    }
  };
}

export const serve_common = {
  init: (config) => {
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
     *     summary: Check health of the server
     *     responses:
     *       200:
     *         description: Server is healthy
     *         content:
     *           text/plain:
     *             schema:
     *               type: string
     *               example: OK
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
    app.get("/health", serveHealthHandler(config));

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
       *       500:
       *         description: Internal server error
       */
      app.get("/kill", serveKillHandler());
    }

    return app;
  },
};
