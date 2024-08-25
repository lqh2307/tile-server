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
 * @param {number} workerID
 * @returns {object}
 */
function loadConfig(workerID) {
  printLog("info", `Loading config file...`, workerID);

  try {
    return loadConfigFile();
  } catch (error) {
    printLog(
      "error",
      `Failed to load config file: ${error}. Exited!`,
      workerID
    );

    process.exit(0);
  }
}

/**
 * Setup watch config file
 * @param {number} workerID
 * @param {object} config
 * @returns {void}
 */
function setupWatchConfigFile(workerID, config) {
  if (config.options.watchToKill > 0) {
    printLog(
      "info",
      `Watch config file changes interval ${config.options.watchToKill}ms to kill server`,
      workerID
    );

    chokidar
      .watch(config.filePath, {
        usePolling: true,
        awaitWriteFinish: true,
        interval: config.options.watchToKill,
      })
      .on("change", () => {
        printLog("info", `Config file has changed. Killed server!`, workerID);

        process.exit(0);
      });
  } else if (config.options.watchToRestart > 0) {
    printLog(
      "info",
      `Watch config file changes interval ${config.options.watchToRestart}ms to restart server`,
      workerID
    );

    chokidar
      .watch(config.filePath, {
        usePolling: true,
        awaitWriteFinish: true,
        interval: config.options.watchToRestart,
      })
      .on("change", () => {
        printLog(
          "info",
          `Config file has changed. Restarting server...`,
          workerID
        );

        process.exit(1);
      });
  }
}

/**
 * Setup express server
 * @param {number} workerID
 * @param {object} config
 * @returns {void}
 */
function setupServer(workerID, config) {
  printLog("info", `Starting HTTP server...`, workerID);

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
      printLog(
        "info",
        `HTTP Server is listening on port: ${config.options.listenPort}`,
        workerID
      );
    })
    .on("error", (error) => {
      printLog("error", `HTTP server is stopped by: ${error}`, workerID);
    });
}

/**
 * Load data
 * @param {number} workerID
 * @param {object} config
 * @returns {void}
 */
function loadData(workerID, config) {
  printLog("info", `Loading data...`, workerID);

  Promise.all([
    serve_font.add(config),
    serve_sprite.add(config),
    serve_data.add(config),
  ])
    .then(() => serve_style.add(config))
    .then(() => serve_rendered.add(config))
    .then(() => {
      printLog("info", `Completed startup!`, workerID);

      config.startupComplete = true;
    })
    .catch((error) => {
      printLog("error", `Failed to load data: ${error}. Exited!`, workerID);

      process.exit(0);
    });
}

/**
 * Start server
 * @param {number} workerID
 * @returns {void}
 */
export function startServer(workerID) {
  const config = loadConfig(workerID);

  setupWatchConfigFile(workerID, config);
  setupServer(workerID, config);
  loadData(workerID, config);
}
