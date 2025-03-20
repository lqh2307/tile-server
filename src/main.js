"use strict";

import { removeOldCacheLocks, getVersion, runCommand } from "./utils.js";
import { initLogger, printLog } from "./logger.js";
import { readConfigFile } from "./config.js";
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
 * @param {{ dataDir: string, restart: boolean }} opts
 * @returns {Promise<void>}
 */
async function startClusterServer(opts) {
  // Init logger
  initLogger(`${opts.dataDir}/logs/log.log`);

  if (cluster.isPrimary === true) {
    // Store ENVs
    process.env.DATA_DIR = opts.dataDir; // Data dir
    process.env.MAIN_PID = process.pid; // Main PID

    /* Read config.json file */
    printLog("info", `Reading config.json file at "${opts.dataDir}"...`);

    const config = await readConfigFile(true);

    const numOfProcess = config.options?.process || 1; // Number of process
    const numOfThread = config.options?.thread || os.cpus().length; // Number of thread

    // Store ENVs
    process.env.UV_THREADPOOL_SIZE = numOfThread; // For libuv
    process.env.POSTGRESQL_BASE_URI = config.options?.postgreSQLBaseURI; // PostgreSQL base URI
    process.env.SERVE_FRONT_PAGE = config.options?.serveFrontPage; // Serve front page
    process.env.SERVE_SWAGGER = config.options?.serveSwagger; // Serve swagger

    // For gdal
    try {
      const gdalVersion = await runCommand("gdalinfo --version");

      printLog(
        "info",
        `Found gdal version "${gdalVersion.trim()}". Enable export render`
      );

      process.env.ENABLE_EXPORT = "true";
      process.env.GDAL_NUM_THREADS = "ALL_CPUS";
    } catch (error) {
      printLog("info", `Not found gdal. Disable export render`);
    }

    /* Remove old cache locks */
    printLog(
      "info",
      `Removing old cache locks at "${opts.dataDir}" before start server...`
    );

    await removeOldCacheLocks();

    printLog(
      "info",
      `Starting server with ${numOfProcess} processes - ${numOfThread} threads...`
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
    if (config.options?.taskSchedule !== undefined) {
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
          restart: true,
          cleanUpSprites: true,
          cleanUpFonts: true,
          cleanUpStyles: true,
          cleanUpGeoJSONs: true,
          cleanUpDatas: true,
          seedSprites: true,
          seedFonts: true,
          seedStyles: true,
          seedGeoJSONs: true,
          seedDatas: true,
        });
      });
    }

    /* Fork servers */
    printLog("info", "Creating workers...");

    for (let i = 0; i < numOfProcess; i++) {
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
              restart: message.restart,
              cleanUpSprites: message.cleanUpSprites,
              cleanUpFonts: message.cleanUpFonts,
              cleanUpStyles: message.cleanUpStyles,
              cleanUpGeoJSONs: message.cleanUpGeoJSONs,
              cleanUpDatas: message.cleanUpDatas,
              seedSprites: message.seedSprites,
              seedFonts: message.seedFonts,
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
              "warn",
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
