"use strict";

<<<<<<< HEAD
import os from "os";

process.env.UV_THREADPOOL_SIZE =
  process.env.UV_THREADPOOL_SIZE || Math.max(4, os.cpus().length * 2);

import { readConfigFile, config } from "./config.js";
=======
import { readConfigFile } from "./config.js";
>>>>>>> b797bd6a94a4133e2e03be35a976c133c06b87dc
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
    /* Read config.json file */
    printLog("info", `Reading config.json file at "${opts.dataDir}"...`);

    const config = await readConfigFile(opts.dataDir, true);

    /* Setup envs & events */
    process.env.DATA_DIR = opts.dataDir; // Store data directory

    process.on("SIGINT", () => {
      printLog("info", `Received "SIGINT" signal. Killing server...`);

      /* Store killed server time */
      updateServerInfoFile({
        lastServerKilled: Date.now(),
      })
        .catch((error) =>
          printLog("error", `Failed to store killed server time: ${error}`)
        )
        .finally(() => process.exit(0));
    });

    process.on("SIGTERM", () => {
      printLog("info", `Received "SIGTERM" signal. Restarting server...`);

      /* Store restarted server time */
      updateServerInfoFile({
        lastServerRestarted: Date.now(),
      })
        .catch((error) =>
          printLog("error", `Failed to store restarted server time: ${error}`)
        )
        .finally(() => process.exit(1));
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

    await removeOldCacheLocks(opts.dataDir);

    /* Store main pid */
    await updateServerInfoFile({
      mainPID: process.pid,
      lastServerStarted: Date.now(),
    });

    printLog(
      "info",
      `Starting server with ${config.options.process} processes...`
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

          restartServer().catch((error) =>
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
        startTask().catch((error) =>
          printLog("error", `Failed to start task: ${error}`)
        )
      );
    }

    /* Fork servers */
    printLog("info", "Creating workers...");

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
    startServer(argOpts.data_dir);
  }
}

/* Run start cluster server */
startClusterServer({
  dataDir: argOpts.data_dir,
  restart: argOpts.restart,
});
