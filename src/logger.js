"use strict";

import pino from "pino";
import fs from "node:fs";

let logger;

/**
 * Init pino logger
 * @param {string} filePath Log file path
 * @returns {void}
 */
export function initLogger(filePath) {
  fs.mkdirSync(path.dirname(filePath), {
    recursive: true,
  });

  logger = pino(
    {
      level: "info",
      formatters: {
        level(label) {
          return {
            level: label.toUpperCase(),
          };
        },
      },
      timestamp: pino.stdTimeFunctions.isoTime,
    },
    pino.multistream([
      { stream: process.stdout },
      { stream: fs.createWriteStream(filePath, { flags: "a" }) },
    ])
  );
}

/**
 * Print log using pino with custom format
 * @param {"debug"|"info"|"warn"|"error"} level Log level
 * @param {string} msg Message
 * @returns {void}
 */
export function printLog(level, msg) {
  logger[level](`[PID = ${process.pid}] ${msg}`);
}
