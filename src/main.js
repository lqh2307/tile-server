"use strict";

import { readConfigFile } from "./config.js";
import { printLog } from "./logger.js";
import { program } from "commander";
import chokidar from "chokidar";
import cluster from "cluster";
import cron from "node-cron";
import {
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
    /* Setup envs */
    process.env.DATA_DIR = opts.dataDir; // Store data directory
    process.env.MAIN_PID = process.pid; // Store main PID

    /* Read config.json file */
    printLog("info", `Reading config.json file at "${opts.dataDir}"...`);

    const config = await readConfigFile(true);

    /* Setup envs */
    process.env.UV_THREADPOOL_SIZE = config.options.thread; // For libuv

    /* Setup events */
    process.on("SIGINT", () => {
      printLog("info", `Received "SIGINT" signal. Killing server...`);

      process.exit(0);
    });

    process.on("SIGTERM", () => {
      printLog("info", `Received "SIGTERM" signal. Restarting server...`);

      process.exit(1);
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
    printLog(
      "info",
      `Removing old cache locks at "${opts.dataDir}" before start server...`
    );

    await removeOldCacheLocks();

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
    startServer();
  }
}

/* Run start cluster server */
startClusterServer({
  dataDir: argOpts.data_dir,
  restart: argOpts.restart,
});
