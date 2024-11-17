"use strict";

import { readConfigFile, config } from "./config.js";
import { printLog } from "./logger.js";
import { program } from "commander";
import chokidar from "chokidar";
import cluster from "cluster";
import cron from "node-cron";
import {
  updateServerInfoFile,
  removeOldCacheLocks,
  restartServer,
  getVersion,
  killServer,
  startTask,
} from "./utils.js";
import {
  cancelTaskInWorker,
  startTaskInWorker,
  startServer,
} from "./server.js";

/* Setup commands */
program
  .description("========== tile-server startup options ==========")
  .usage("tile-server server [options]")
  .option("-d, --data_dir <dir>", "Data directory", "data")
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
  const dataDir = opts.dataDir;

  /* Load config.json file */
  printLog("info", `Loading config.json file at "${dataDir}"...`);

  await readConfigFile(dataDir, cluster.isPrimary);

  if (cluster.isPrimary === true) {
    /* Setup envs & events */
    process.env.UV_THREADPOOL_SIZE = config.options.thread; // For libuv
    process.env.DATA_DIR = dataDir; // Store data directory

    process.on("SIGINT", () => {
      printLog("info", `Received "SIGINT" signal. Killing server...`);

      /* Store killed server time */
      updateServerInfoFile({
        lastServerKilled: new Date().toISOString(),
      })
        .then(() => process.exit(0))
        .catch(() =>
          printLog("error", `Failed to store killed server time: ${error}`)
        );
    });

    process.on("SIGTERM", () => {
      printLog("info", `Received "SIGTERM" signal. Restarting server...`);

      /* Store restarted server time */
      updateServerInfoFile({
        lastServerRestarted: new Date().toISOString(),
      })
        .catch(() =>
          printLog("error", `Failed to store restarted server time: ${error}`)
        )
        .then(() => process.exit(1))
        .catch(() =>
          printLog("error", `Failed to store restarted server time: ${error}`)
        );
    });

    process.on("SIGUSR1", () => {
      printLog("info", `Received "SIGUSR1" signal. Starting task...`);

      startTaskInWorker({
        restartServerAfterTask: config.options.restartServerAfterTask,
      });
    });

    process.on("SIGUSR2", () => {
      printLog("info", `Received "SIGUSR2" signal. Canceling task...`);

      cancelTaskInWorker();
    });

    /* Remove old cache locks */
    printLog("info", `Removing old cache locks before start server...`);

    await removeOldCacheLocks(dataDir);

    /* Store main pid */
    await updateServerInfoFile({
      mainPID: process.pid,
    });

    printLog(
      "info",
      `Starting server with ${config.options.process} processes...`
    );

    /* Setup watch config file change */
    if (config.options.killInterval > 0) {
      printLog(
        "info",
        `Watch config file changes interval ${config.options.killInterval}ms to kill server`
      );

      chokidar
        .watch(`${dataDir}/config.json`, {
          usePolling: true,
          awaitWriteFinish: true,
          interval: config.options.killInterval,
        })
        .on("change", () => {
          printLog("info", "Config file has changed. Killing server...");

          killServer().catch(() =>
            printLog("error", `Failed to kill server: ${error}`)
          );
        });
    } else if (config.options.restartInterval > 0) {
      printLog(
        "info",
        `Watch config file changes interval ${config.options.restartInterval}ms to restart server`
      );

      chokidar
        .watch(`${dataDir}/config.json`, {
          usePolling: true,
          awaitWriteFinish: true,
          interval: config.options.restartInterval,
        })
        .on("change", () => {
          printLog("info", "Config file has changed. Restarting server...");

          restartServer().catch(() =>
            printLog("error", `Failed to restart server: ${error}`)
          );
        });
    }

    /* Setup cron */
    if (config.options.taskSchedule !== undefined) {
      printLog(
        "info",
        `Schedule run seed and clean up tasks at: "${config.options.taskSchedule}"`
      );

      cron.schedule(config.options.taskSchedule, () =>
        startTask().catch(() =>
          printLog("error", `Failed to start task: ${error}`)
        )
      );
    }

    /* Fork servers */
    if (config.options.process > 1) {
      for (let i = 0; i < config.options.process; i++) {
        cluster.fork();
      }

      cluster.on("exit", (worker, code, signal) => {
        printLog(
          "info",
          `PID = ${worker.process.pid} is died - Code: ${code} - Signal: ${signal}. Creating new one...`
        );

        cluster.fork();
      });
    } else {
      startServer();
    }
  } else {
    startServer();
  }
}

/* Run start cluster server */
startClusterServer({
  dataDir: argOpts.data_dir,
});
