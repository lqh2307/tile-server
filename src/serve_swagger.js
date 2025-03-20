"use strict";

import { updateConfigFile, readConfigFile, config } from "./config.js";
import { updateCleanUpFile, readCleanUpFile } from "./cleanup.js";
import { readSeedFile, updateSeedFile } from "./seed.js";
import { StatusCodes } from "http-status-codes";
import swaggerUi from "swagger-ui-express";
import swaggerJsdoc from "swagger-jsdoc";
import { printLog } from "./logger.js";
import express from "express";
import {
  getXYZFromLonLatZ,
  compileTemplate,
  getRequestHost,
  getJSONSchema,
  validateJSON,
  getVersion,
} from "./utils.js";

/**
 * Serve swagger handler
 * @returns {(req: any, res: any, next: any) => Promise<any>}
 */
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
        servers: [
          {
            url: getRequestHost(req),
            description: "Tile server",
          },
        ],
        apis: ["src/*.js"],
      })
    )(req, res, next);
  };
}

export const serve_swagger = {
  init: () => {
    const app = express().disable("x-powered-by");

    if (process.env.SERVE_SWAGGER !== "false") {
      app.use("/index.html", swaggerUi.serve, serveSwagger());
    }

    return app;
  },
};
