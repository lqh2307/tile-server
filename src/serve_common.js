"use strict";

import { StatusCodes } from "http-status-codes";
import { printLog } from "./utils.js";
import express from "express";

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

    /* Check health */
    app.get("/health", serveHealthHandler(config));

    /* Restart */
    if (config.options.restartEndpoint === true) {
      app.get("/restart", serveRestartHandler());
    }

    /* Kill */
    if (config.options.killEndpoint === true) {
      app.get("/kill", serveKillHandler());
    }

    return app;
  },
};
