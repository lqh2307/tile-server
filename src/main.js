"use strict";

import { updateServerInfoFile, removeOldCacheLocks } from "./utils.js";
import { readConfigFile, config } from "./config.js";
import { printLog } from "./logger.js";
import { program } from "commander";
import chokidar from "chokidar";
import cluster from "cluster";
import cron from "node-cron";
import fs from "node:fs";
import os from "os";
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
  .version(
    JSON.parse(fs.readFileSync("package.json", "utf8")).version,
    "-v, --version"
  )
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
  /* Load config.json file */
  printLog("info", `Loading config.json file at "${opts.dataDir}"...`);

  await readConfigFile(opts.dataDir);

  if (cluster.isPrimary === true) {
    /* Setup envs & events */
    process.env.UV_THREADPOOL_SIZE = Math.max(4, os.cpus().length); // For libuv

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
        dataDir: opts.dataDir,
        restartServerAfterTask: config.options.restartServerAfterTask,
      });
    });

    process.on("SIGUSR2", () => {
      printLog("info", `Received "SIGUSR2" signal. Canceling task...`);

      cancelTaskInWorker();
    });

    //     printLog(
    //       "info",
    //       `

    //                    _oo0oo_
    //                   o8888888o
    //                   88' . '88
    //                   (| -_- |)
    //                   0\\  =  /0
    //                 ___/'---'\\___
    //               .' \\\\|     |// '.
    //              / \\\\|||  :  |||// \\
    //             / _||||| -:- |||||_ \\
    //            |   | \\\\\\  -  /// |   |
    //            | \\_|  ''\\---/''  |_/ |
    //            \\  .-\\___ '-' ___/-.  /
    //          ___'. .'  /--.--\\  '. .'___
    //        .'' '< '.___\\_<|>_/___.' >' ''.
    //      | | :  '- \\'.;'\\ _ /';.'/ -'  : | |
    //      \\  \\ '_.   \\_ __\\ /__ _/   ._' /  /
    //       '-.____'.___ \\_____/___.-'____.-'
    //                    '=---='
    //         Buddha bless, server immortal
    //       Starting server with ${config.options.process} processes
    // `
    //     );

    /* Remove old cache locks */
    printLog("info", `Remove old cache locks before start server...`);

    await removeOldCacheLocks(opts.dataDir);

    /* Store main pid */
    await updateServerInfoFile({
      mainPID: process.pid,
    });

    printLog("info", `Starting server with ${config.options.process} processes...`);

    /* Load config.json file */
    printLog("info", `Loading config.json file at "${opts.dataDir}"...`);

    await readConfigFile(opts.dataDir);

    /* Setup watch config file change */
    if (config.options.killInterval > 0) {
      printLog(
        "info",
        `Watch config file changes interval ${config.options.killInterval}ms to kill server`
      );

      chokidar
        .watch(`${opts.dataDir}/config.json`, {
          usePolling: true,
          awaitWriteFinish: true,
          interval: config.options.killInterval,
        })
        .on("change", () => {
          printLog("info", "Config file has changed. Killing server...");

          process.exit(0);
        });
    } else if (config.options.restartInterval > 0) {
      printLog(
        "info",
        `Watch config file changes interval ${config.options.restartInterval}ms to restart server`
      );

      chokidar
        .watch(`${opts.dataDir}/config.json`, {
          usePolling: true,
          awaitWriteFinish: true,
          interval: config.options.restartInterval,
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
        startTaskInWorker({
          dataDir: opts.dataDir,
          restartServerAfterTask: config.options.restartServerAfterTask,
        });
      });
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
