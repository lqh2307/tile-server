"use strict";

import fs from "node:fs";
import pino from "pino";

let logger;

/**
 * Init pino logger
 * @returns {void}
 */
export function initLogger() {
  fs.mkdirSync(process.env.LOG_DIR, {
    recursive: true,
  });

  logger = pino(
    {
      level: "info",
      base: null,
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
      {
        stream: fs.createWriteStream(`${process.env.LOG_DIR}/logs.log`, {
          flags: "a",
        }),
      },
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
