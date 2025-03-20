"use strict";

import { config, loadConfigFile } from "./config.js";
import { loggerMiddleware } from "./middleware.js";
import { serve_geojson } from "./serve_geojson.js";
import { serve_common } from "./serve_common.js";
import { serve_sprite } from "./serve_sprite.js";
import { serve_style } from "./serve_style.js";
import { Worker } from "node:worker_threads";
import { serve_font } from "./serve_font.js";
import { serve_data } from "./serve_data.js";
import { serve_task } from "./serve_task.js";
import { loadSeedFile } from "./seed.js";
import { printLog } from "./logger.js";
import express from "express";
import cors from "cors";

let currentTaskWorker;

/**
 * Start task in worker
 * @param {Object} opts Options
 * @returns {void}
 */
export function startTaskInWorker(opts) {
  if (currentTaskWorker === undefined) {
    currentTaskWorker = new Worker("./src/task_worker.js", {
      workerData: opts,
    })
      .on("error", (error) => {
        printLog("error", `Task worker error: ${error}`);

        currentTaskWorker = undefined;
      })
      .on("exit", (code) => {
        currentTaskWorker = undefined;

        if (code !== 0) {
          printLog("error", `Task worker exited with code: ${code}`);
        }
      })
      .on("message", (message) => {
        if (message.error) {
          printLog("error", `Task worker error: ${message.error}`);
        }

        if (message.action === "restartServer") {
          process.exit(1);
        }

        currentTaskWorker = undefined;
      });
  } else {
    printLog("warn", "A task is already running. Skipping start task...");
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
      .catch((error) => {
        printLog("error", `Task worker error: ${error}`);
      })
      .finally(() => {
        currentTaskWorker = undefined;
      });
  } else {
    printLog("warn", "No task is currently running. Skipping cancel task...");
  }
}

/**
 * Start server
 * @returns {Promise<void>}
 */
export async function startServer() {
  try {
    /* Load configs */
    printLog(
      "info",
      `Loading config.json and seed.json files at "${process.env.DATA_DIR}"...`
    );

    await Promise.all([loadConfigFile(), loadSeedFile()]);

    /* Start HTTP server */
    printLog("info", "Starting HTTP server...");

    const listenPort = config.options?.listenPort || 8080;

    express()
      .disable("x-powered-by")
      .enable("trust proxy")
      .use(cors())
      .use(express.json())
      .use(loggerMiddleware())
      .use("/", serve_common.init())
      .use("/datas", serve_data.init())
      .use("/geojsons", serve_geojson.init())
      .use("/fonts", serve_font.init())
      .use("/sprites", serve_sprite.init())
      .use("/styles", serve_style.init())
      .use("/tasks", serve_task.init())
      .listen(listenPort, () => {
        printLog("info", `HTTP server is listening on port "${listenPort}"...`);
      })
      .on("error", (error) => {
        printLog("error", `HTTP server is stopped by: ${error}`);
      });

    /* Load datas */
    printLog("info", "Loading data...");

    Promise.all([
      serve_font.add(),
      serve_sprite.add(),
      serve_data.add(),
      serve_geojson.add(),
    ])
      .then(() => serve_style.add())
      .then(() => {
        /* Update STARTING_UP ENV */
        process.env.STARTING_UP = "false";

        printLog("info", "Completed startup!");

        /* Clean */
        delete config.styles;
        delete config.geojsons;
        delete config.datas;
        delete config.sprites;
        delete config.fonts;
      })
      .catch((error) => {
        printLog("error", `Failed to load data: ${error}. Exited!`);

        process.send({
          action: "killServer",
        });
      });
  } catch (error) {
    printLog("error", `Failed to start server: ${error}. Exited!`);

    process.send({
      action: "killServer",
    });
  }
}
