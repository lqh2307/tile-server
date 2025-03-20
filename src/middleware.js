"use strict";

import { StatusCodes } from "http-status-codes";
import { printLog } from "./logger.js";

/**
 * Check ready middleware
 * @returns {void}
 */
export function checkReadyMiddleware() {
  return async (req, res, next) => {
    try {
      if (process.env.STARTING_UP === undefined) {
        return res.status(StatusCodes.SERVICE_UNAVAILABLE).send("Starting...");
      }

      next();
    } catch (error) {
      printLog("error", `Failed to check ready server: ${error}`);

      return res
        .status(StatusCodes.INTERNAL_SERVER_ERROR)
        .send("Internal server error");
    }
  };
}

/**
 * Logger middleware
 * @returns {void}
 */
export function loggerMiddleware() {
  return async (req, res, next) => {
    const start = process.hrtime();

    res.on("finish", () => {
      const diff = process.hrtime(start);

      printLog(
        "info",
        `[PID = ${process.pid}] ${req.method} ${req.originalUrl} ${
          res.statusCode
        } ${res.get("Content-Length") || 0} ${(
          diff[0] * 1e3 +
          diff[1] / 1e6
        ).toFixed(2)} ${req.ip} ${req.get("User-Agent")}`
      );
    });

    next();
  };
}
