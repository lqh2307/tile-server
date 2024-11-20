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
