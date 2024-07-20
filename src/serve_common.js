"use strict";

import express from "express";
import { printLog } from "./utils.js";

function serveHealthHandler(config) {
  return async (req, res, next) => {
    return async (req, res, next) => {
      if (config.startupComplete === false) {
        return res.status(503).send("Starting...");
      }

      return res.status(200).send("OK");
    };
  };
}

function serveRestartHandler() {
  return async (req, res, next) => {
    return async (req, res, next) => {
      printLog("info", "Received restart request. Restarting server...");

      setTimeout(() => {
        process.exit(1);
      }, 0);

      return res.status(200).send("OK");
    };
  };
}

function serveKillHandler() {
  return async (req, res, next) => {
    return async (req, res, next) => {
      printLog("info", "Received kill request. Killed server!");

      setTimeout(() => {
        process.exit(0);
      }, 0);

      return res.status(200).send("OK");
    };
  };
}

export const serve_common = {
  init: (config) => {
    const app = express();

    app.get("/health", serveHealthHandler(config));

    if (config.options.restartEndpoint === true) {
      app.get("/restart", serveRestartHandler());
    }

    if (config.options.killEndpoint === true) {
      app.get("/kill", serveKillHandler());
    }

    return app;
  },
};
