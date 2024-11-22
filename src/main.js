"use strict";

import { readConfigFile, config } from "./config.js";
import { printLog } from "./logger.js";
import { program } from "commander";
import chokidar from "chokidar";
import cluster from "cluster";
import cron from "node-cron";
import {
  updateServerInfoFileWithLock,
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
      updateServerInfoFileWithLock(
        {
          lastServerKilled: Date.now(),
        },
        60000 // 1 mins
      )
        .catch((error) =>
          printLog("error", `Failed to store killed server time: ${error}`)
        )
        .finally(() => process.exit(0));
    });

    process.on("SIGTERM", () => {
      printLog("info", `Received "SIGTERM" signal. Restarting server...`);

      /* Store restarted server time */
      updateServerInfoFileWithLock(
        {
          lastServerRestarted: Date.now(),
        },
        60000 // 1 mins
      )
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

    await removeOldCacheLocks(dataDir);

    /* Store main pid */
    await updateServerInfoFileWithLock(
      {
        mainPID: process.pid,
        lastServerStarted: Date.now(),
      },
      60000 // 1 mins
    );

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

          killServer().catch((error) =>
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
