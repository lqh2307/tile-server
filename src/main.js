"use strict";

import { removeOldCacheLocks, getVersion } from "./utils.js";
import { readConfigFile } from "./config.js";
import { printLog } from "./logger.js";
import { program } from "commander";
import chokidar from "chokidar";
import cluster from "cluster";
import cron from "node-cron";
import {
  cancelTaskInWorker,
  startTaskInWorker,
  startServer,
} from "./server.js";
import os from "os";

/* Setup commands */
program
  .description("========== tile-server startup options ==========")
  .usage("tile-server server [options]")
  .option("-d, --data_dir <dir>", "Data directory", "data")
  .option("-r, --restart", "Auto restart server if config file has changed")
  .version(getVersion())
  .showHelpAfterError()
  .parse(process.argv);

/* Load args */
const argOpts = program.opts();

/**
 * Start cluster server
 * @param {object} opts
 * @returns {Promise<void>}
 */
async function startClusterServer(opts) {
  if (cluster.isPrimary === true) {
    // Store ENVs
    process.env.DATA_DIR = opts.dataDir; // Data dir
    process.env.MAIN_PID = process.pid; // Main PID

    /* Read config.json file */
    printLog("info", `Reading config.json file at "${opts.dataDir}"...`);

    const config = await readConfigFile(true);

    // Store ENVs
    process.env.NUM_OF_PROCESS = config.options.process || 1; // Number of process
    process.env.NUM_OF_THREAD = config.options.thread || os.cpus().length; // Number of thread
    process.env.UV_THREADPOOL_SIZE = process.env.NUM_OF_THREAD; // For libuv
    process.env.POSTGRESQL_BASE_URI = config.options.postgreSQLBaseURI; // PostgreSQL base URI
    process.env.SERVE_SERVER_ENDPOINT = config.options.serverEndpoint; // Serve server endpoint
    process.env.SERVE_FRONT_PAGE = config.options.serveFrontPage; // Serve front page
    process.env.SERVE_SWAGGER = config.options.serveSwagger; // Serve swagger
    process.env.RESTART_SERVER_AFTER_TASK =
      config.options.restartServerAfterTask; // Restart server after task
    process.env.GDAL_NUM_THREADS = "ALL_CPUS"; // For gdal
    process.env.FALLBACK_FONT = "Open Sans Regular"; // Fallback font

    /* Remove old cache locks */
    printLog(
      "info",
      `Removing old cache locks at "${opts.dataDir}" before start server...`
    );

    await removeOldCacheLocks();

    printLog(
      "info",
      `Starting server with ${process.env.NUM_OF_PROCESS} processes...`
    );

    /* Setup watch config file change */
    if (opts.restart) {
      printLog("info", "Auto restart server if config file has changed");

      chokidar
        .watch(`${opts.dataDir}/config.json`, {
          usePolling: true,
          awaitWriteFinish: true,
          interval: 500,
        })
        .on("change", () => {
          printLog("info", "Config file has changed. Restarting server...");

          process.exit(1);
        });
    }

    /* Setup cron */
    if (config.options.taskSchedule !== undefined) {
      printLog(
        "info",
        `Schedule run seed and clean up tasks at: "${config.options.taskSchedule}"`
      );

      cron.schedule(config.options.taskSchedule, () => {
        printLog(
          "info",
          "Seed and clean up tasks triggered by schedule. Starting task..."
        );

        startTaskInWorker({
          restartServerAfterTask: process.env.RESTART_SERVER_AFTER_TASK,
          cleanUpStyles: true,
          cleanUpGeoJSONs: true,
          cleanUpDatas: true,
          seedStyles: true,
          seedGeoJSONs: true,
          seedDatas: true,
        });
      });
    }

    /* Fork servers */
    printLog("info", "Creating workers...");

    for (let i = 0; i < Number(process.env.NUM_OF_PROCESS) || 1; i++) {
      cluster.fork();
    }

    cluster
      .on("exit", (worker, code, signal) => {
        printLog(
          "info",
          `Worker with PID = ${worker.process.pid} is died - Code: ${code} - Signal: ${signal}. Creating new one...`
        );

        cluster.fork();
      })
      .on("message", (worker, message) => {
        switch (message.action) {
          case "killServer": {
            printLog(
              "info",
              `Received "killServer" message from worker with PID = ${worker.process.pid}. Killing server...`
            );

            process.exit(0);
          }

          case "restartServer": {
            printLog(
              "info",
              `Received "restartServer" message from worker with PID = ${worker.process.pid}. Restarting server...`
            );

            process.exit(1);
          }

          case "startTask": {
            printLog(
              "info",
              `Received "startTask" message from worker with PID = ${worker.process.pid}. Starting task...`
            );

            startTaskInWorker({
              restartServerAfterTask: process.env.RESTART_SERVER_AFTER_TASK,
              cleanUpStyles: message.cleanUpStyles,
              cleanUpGeoJSONs: message.cleanUpGeoJSONs,
              cleanUpDatas: message.cleanUpDatas,
              seedStyles: message.seedStyles,
              seedGeoJSONs: message.seedGeoJSONs,
              seedDatas: message.seedDatas,
            });

            break;
          }

          case "cancelTask": {
            printLog(
              "info",
              `Received "cancelTask" message from worker with PID = ${worker.process.pid}. Canceling task...`
            );

            cancelTaskInWorker();

            break;
          }

          default: {
            printLog(
              "warning",
              `Received unknown message "${message.action}" from worker with PID = ${worker.process.pid}. Skipping...`
            );

            break;
          }
        }
      });
  } else {
    startServer();
  }
}

/* Run start cluster server */
startClusterServer({
  dataDir: argOpts.data_dir,
  restart: argOpts.restart,
});
