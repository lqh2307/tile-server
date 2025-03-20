"use strict";

import { StatusCodes } from "http-status-codes";
import { setMetrics } from "./prometheus.js";
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
    const method = req.method || "-";
    const protocol = req.protocol || "-";
    const path = req.originalUrl || "-";
    const statusCode = res.statusCode || "-";
    const origin = req.headers["origin"] || req.headers["referer"] || "-";
    const ip = req.ip || "-";
    const userAgent = req.headers["user-agent"] || "-";

    res.on("finish", () => {
      const diff = process.hrtime(start);
      const duration = diff[0] * 1e3 + diff[1] / 1e6;

      printLog(
        "info",
        `${method} ${protocol} ${path} ${statusCode} ${duration} ${origin} ${ip} ${userAgent}`
      );

      setMetrics(
        method,
        protocol,
        path,
        statusCode,
        origin,
        ip,
        userAgent,
        duration
      );
    });

    next();
  };
}
