"use strict";

import { updateServerInfoFile, checkReadyMiddleware } from "./utils.js";
import { cancelTaskInWorker, startTaskInWorker } from "./task.js";
import { serve_rendered } from "./serve_rendered.js";
import { serve_template } from "./serve_template.js";
import { readConfigFile, config } from "./config.js";
import { serve_common } from "./serve_common.js";
import { serve_sprite } from "./serve_sprite.js";
import { serve_style } from "./serve_style.js";
import { serve_font } from "./serve_font.js";
import { serve_data } from "./serve_data.js";
import { serve_task } from "./serve_task.js";
import fsPromise from "node:fs/promises";
import { printLog } from "./logger.js";
import express from "express";
import morgan from "morgan";
import cors from "cors";

/**
 * Get main PID
 * @returns {Promise<number>}
 */
export async function getMainPID() {
  try {
    const data = await fsPromise.readFile("server-info.json", "utf8");

    return JSON.parse(data).mainPID;
  } catch (error) {
    if (error.code === "ENOENT") {
      return;
    }

    throw error;
  }
}

/**
 * Load config file
 * @param {string} dataDir Data directory
 * @returns {Promise<void>}
 */
async function loadConfigFile(dataDir) {
  printLog("info", `Loading config.json file at "${dataDir}"...`);

  try {
    await readConfigFile(dataDir);
  } catch (error) {
    throw new Error(
      `Failed to load config.json file at "${dataDir}": ${error}`
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
 * Restart server
 * @returns {Promise<void>}
 */
export async function restartServer() {
  const mainPID = await getMainPID();

  if (mainPID !== undefined) {
    await updateServerInfoFile({
      mainPID: undefined,
    });

    process.kill(mainPID, "SIGTERM");
  }
}

/**
 * Kill server
 * @returns {Promise<void>}
 */
export async function killServer() {
  const mainPID = await getMainPID();

  if (mainPID !== undefined) {
    await updateServerInfoFile({
      mainPID: undefined,
    });

    process.kill(mainPID, "SIGINT");
  }
}

/**
 * Start server
 * @param {string} dataDir
 * @returns {Promise<void>}
 */
export async function startServer(dataDir) {
  try {
    await loadConfigFile(dataDir);

    startHTTPServer();

    loadData();

    process.on("SIGUSR1", () => {
      printLog("info", `Received "SIGUSR1" signal. Starting task...`);

      startTaskInWorker(dataDir);
    });

    process.on("SIGUSR2", () => {
      printLog("info", `Received "SIGUSR2" signal. Canceling task...`);

      cancelTaskInWorker();
    });
  } catch (error) {
    printLog("error", `Failed to start server: ${error}. Exited!`);

    await killServer();
  }
}
