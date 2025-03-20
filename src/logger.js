"use strict";

import path from "node:path";
import fs from "node:fs";
import pino from "pino";

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
            level: label,
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
 * @param {"fatal"|"error"|"warn"|"info"|"debug"|"trace"} level Log level
 * @param {string} msg Message
 * @returns {void}
 */
export function printLog(level, msg) {
  logger[level](msg);
}
