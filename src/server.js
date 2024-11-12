"use strict";

import { checkReadyMiddleware, killServer, restartServer } from "./utils.js";
import { serve_rendered } from "./serve_rendered.js";
import { serve_template } from "./serve_template.js";
import { serve_common } from "./serve_common.js";
import { serve_sprite } from "./serve_sprite.js";
import { serve_style } from "./serve_style.js";
import { Worker } from "node:worker_threads";
import { serve_font } from "./serve_font.js";
import { serve_data } from "./serve_data.js";
import { serve_task } from "./serve_task.js";
import { printLog } from "./logger.js";
import { config } from "./config.js";
import express from "express";
import morgan from "morgan";
import cors from "cors";

let currentTaskWorker;

/**
 * Start task in worker
 * @param {object} opts Options
 * @returns {void}
 */
export function startTaskInWorker(opts) {
  if (currentTaskWorker === undefined) {
    new Worker("./src/task_worker.js", {
      workerData: opts,
    })
      .on("message", (message) => {
        if (message.error) {
          printLog("error", `Task failed: ${message.error}`);
        }

        currentTaskWorker = undefined;
      })
      .on("error", (error) => {
        printLog("error", `Task worker error: ${error}`);

        currentTaskWorker = undefined;
      })
      .on("exit", (code) => {
        if (code !== 0) {
          printLog("error", `Task worker stopped with exit code: ${code}`);
        }

        currentTaskWorker = undefined;
      });
  } else {
    printLog("warning", "A task is already running. Skipping start task...");
  }
}

/**
 * Cancel task in worker
 * @returns {void}
 */
export function cancelTaskInWorker() {
  if (currentTaskWorker !== undefined) {
    currentTaskWorker
      .terminate()
      .then(() => {
        currentTaskWorker = undefined;
      })
      .catch((error) => {
        printLog("error", `Task worker error: ${error}`);
      });
  } else {
    printLog(
      "warning",
      "No task is currently running. Skipping cancel task..."
    );
  }
}

/**
 * Start HTTP server
 * @returns {void}
 */
function startHTTPServer() {
  printLog("info", "Starting HTTP server...");

  try {
    express()
      .disable("x-powered-by")
      .enable("trust proxy")
      .use(cors())
      .use(morgan(`[PID = ${process.pid}] ${config.options.loggerFormat}`))
      .use("/", serve_common.init())
      .use("/", checkReadyMiddleware(), serve_template.init())
      .use("/datas", checkReadyMiddleware(), serve_data.init())
      .use("/fonts", checkReadyMiddleware(), serve_font.init())
      .use("/sprites", checkReadyMiddleware(), serve_sprite.init())
      .use("/styles", checkReadyMiddleware(), serve_style.init())
      .use("/styles", checkReadyMiddleware(), serve_rendered.init())
      .use("/tasks", checkReadyMiddleware(), serve_task.init())
      .listen(config.options.listenPort, () => {
        printLog(
          "info",
          `HTTP server is listening on port "${config.options.listenPort}"...`
        );
      })
      .on("error", (error) => {
        printLog("error", `HTTP server is stopped by: ${error}`);
      });
  } catch (error) {
    throw new Error(`Failed to start HTTP server: ${error}`);
  }
}

/**
 * Load data into services
 * @returns {Promise<void>}
 */
async function loadData() {
  printLog("info", "Loading data...");

  try {
    await Promise.all([serve_font.add(), serve_sprite.add(), serve_data.add()]);
    await serve_style.add();
    await serve_rendered.add();

    printLog("info", "Completed startup!");

    config.startupComplete = true;
  } catch (error) {
    printLog("error", `Failed to load data: ${error}. Exited!`);

    await restartServer();
  }
}

/**
 * Start server
 * @returns {Promise<void>}
 */
export async function startServer() {
  try {
    startHTTPServer();

    loadData();
  } catch (error) {
    printLog("error", `Failed to start server: ${error}. Exited!`);

    await killServer();
  }
}
