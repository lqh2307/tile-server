"use strict";

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
import {
  checkReadyMiddleware,
  updateServerInfoFile,
  killServer,
} from "./utils.js";

let currentTaskWorker;

/**
 * Start task in worker
 * @param {object} opts Options
 * @returns {void}
 */
export function startTaskInWorker(opts) {
  if (currentTaskWorker === undefined) {
    /* Store started task time */
    updateServerInfoFile({
      lastTaskStarted: new Date().toISOString(),
    }).catch(() =>
      printLog("error", `Failed to store started task time: ${error}`)
    );

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
        currentTaskWorker = undefined;

        if (code === 0) {
          /* Store done task time */
          updateServerInfoFile({
            lastTaskDone: new Date().toISOString(),
          }).catch(() =>
            printLog("error", `Failed to store done task time: ${error}`)
          );
        } else if (code === 1) {
          /* Store canceled task time */
          updateServerInfoFile({
            lastTaskCanceled: new Date().toISOString(),
          }).catch(() =>
            printLog("error", `Failed to store canceled task time: ${error}`)
          );
        } else {
          /* Store failed task time */
          updateServerInfoFile({
            lastTaskFailed: new Date().toISOString(),
          }).catch(() =>
            printLog("error", `Failed to store failed task time: ${error}`)
          );
        }
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
    /* Load data */
    await Promise.all([serve_font.add(), serve_sprite.add(), serve_data.add()]);
    await serve_style.add();
    await serve_rendered.add();

    /* Clean */
    config.styles = undefined;
    config.datas = undefined;
    config.sprites = undefined;
    config.fonts = undefined;

    /* Update STARTING_UP ENV */
    process.env.STARTING_UP = "false";

    printLog("info", "Completed startup!");
  } catch (error) {
    printLog("error", `Failed to load data: ${error}. Exited!`);

    killServer().catch(() =>
      printLog("error", `Failed to kill server: ${error}`)
    );
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

    killServer().catch(() =>
      printLog("error", `Failed to kill server: ${error}`)
    );
  }
}
