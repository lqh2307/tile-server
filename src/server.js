"use strict";

import { serve_rendered } from "./serve_rendered.js";
import { serve_template } from "./serve_template.js";
import { serve_common } from "./serve_common.js";
import { serve_sprite } from "./serve_sprite.js";
import { serve_style } from "./serve_style.js";
import { serve_font } from "./serve_font.js";
import { serve_data } from "./serve_data.js";
import { loadConfigFile } from "./config.js";
import { printLog } from "./utils.js";
import chokidar from "chokidar";
import express from "express";
import morgan from "morgan";
import cors from "cors";

/**
 * Load config.json file
 * @param {workerID} worker ID
 * @returns {config}
 */
function loadConfig(workerID) {
  printLog("info", `[${workerID}] Loading config file...`);

  try {
    return loadConfigFile();
  } catch (error) {
    printLog("error", `[${workerID}] Failed to load config file: ${error}. Exited!`);

    process.exit(0);
  }
}

/**
 * Setup watch config file
 * @param {workerID} worker ID
 * @param {object} config
 * @returns {void}
 */
function setupWatchConfigFile(workerID, config) {
  if (config.options.watchToKill > 0) {
    printLog("info", `[${workerID}] Watch config file changes interval ${config.options.watchToKill}ms to kill server`);

    chokidar
      .watch(config.filePath, {
        usePolling: true,
        awaitWriteFinish: true,
        interval: config.options.watchToKill,
      })
      .on("change", () => {
        printLog("info", `[${workerID}] Config file has changed. Killed server!`);

        process.exit(0);
      });
  } else if (config.options.watchToRestart > 0) {
    printLog("info", `[${workerID}] Watch config file changes interval ${config.options.watchToRestart}ms to restart server`);

    chokidar
      .watch(config.filePath, {
        usePolling: true,
        awaitWriteFinish: true,
        interval: config.options.watchToRestart,
      })
      .on("change", () => {
        printLog("info", `[${workerID}] Config file has changed. Restarting server...`);

        process.exit(1);
      });
  }
}

/**
 * Setup express server
 * @param {workerID} worker ID
 * @param {object} config
 * @returns {void}
 */
function setupServer(workerID, config) {
  printLog("info", `[${workerID}] Starting HTTP server...`);

  express()
    .disable("x-powered-by")
    .enable("trust proxy")
    .use(cors())
    .use(morgan(config.options.loggerFormat))
    .use("/", serve_common.init(config))
    .use("/", serve_template.init(config))
    .use("/data", serve_data.init(config))
    .use("/fonts", serve_font.init(config))
    .use("/sprites", serve_sprite.init(config))
    .use("/styles", serve_style.init(config))
    .use("/styles", serve_rendered.init(config))
    .listen(config.options.listenPort, () => {
      printLog("info", `[${workerID}] HTTP Server is listening on port: ${config.options.listenPort}`);
    })
    .on("error", (error) => {
      printLog("error", `[${workerID}] HTTP server is stopped by: ${error}`);
    });
}

/**
 * Load data
 * @param {workerID} worker ID
 * @param {object} config
 * @returns {void}
 */
function loadData(workerID, config) {
  printLog("info", `[${workerID}] Loading data...`);

  Promise.all([serve_font.add(config), serve_sprite.add(config), serve_data.add(config)])
    .then(() => serve_style.add(config))
    .then(() => serve_rendered.add(config))
    .then(() => {
      printLog("info", `[${workerID}] Completed startup!`);

      config.startupComplete = true;
    })
    .catch((error) => {
      printLog("error", `[${workerID}] Failed to load data: ${error}. Exited!`);

      process.exit(0);
    });
}

/**
 * Start server
 * @param {workerID} worker ID
 * @returns {void}
 */
export function startServer(workerID) {
  const config = loadConfig(workerID);

  setupWatchConfigFile(workerID, config);
  setupServer(workerID, config);
  loadData(workerID, config);
}
