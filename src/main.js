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
  .option("-n, --num_processes <num>", "Number of processes", "1")
  .option("-r, --restart_interval <num>", "Interval to restart server", "0")
  .option("-k, --kill_interval <num>", "Interval to kill server", "0")
  .option(
    "-t, --restart_server_after_task",
    "Restart server after seed and cleanup tasks"
  )
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

      startTaskInWorker(opts);
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
    //       Starting server with ${opts.numProcesses} processes
    // `
    //     );

    /* Remove old cache locks */
    printLog("info", `Remove old cache locks before start server...`);

    await removeOldCacheLocks(opts.dataDir);

    /* Store main pid */
    await updateServerInfoFile({
      mainPID: process.pid,
    });

    printLog("info", `Starting server with ${opts.numProcesses} processes...`);

    /* Setup watch config file change */
    if (opts.killInterval > 0) {
      printLog(
        "info",
        `Watch config file changes interval ${opts.killInterval}ms to kill server`
      );

      chokidar
        .watch(`${opts.dataDir}/config.json`, {
          usePolling: true,
          awaitWriteFinish: true,
          interval: opts.killInterval,
        })
        .on("change", () => {
          printLog("info", "Config file has changed. Killing server...");

          process.exit(0);
        });
    } else if (opts.restartInterval > 0) {
      printLog(
        "info",
        `Watch config file changes interval ${opts.restartInterval}ms to restart server`
      );

      chokidar
        .watch(`${opts.dataDir}/config.json`, {
          usePolling: true,
          awaitWriteFinish: true,
          interval: opts.restartInterval,
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
        startTaskInWorker(opts);
      });
    }

    /* Fork servers */
    if (opts.numProcesses > 1) {
      for (let i = 0; i < opts.numProcesses; i++) {
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
      startServer(opts);
    }
  } else {
    startServer(opts);
  }
}

/* Run start cluster server */
startClusterServer({
  numProcesses: Number(argOpts.num_processes),
  killInterval: Number(argOpts.kill_interval),
  restartInterval: Number(argOpts.restart_interval),
  dataDir: argOpts.data_dir,
  restartServerAfterTask: argOpts.restart_server_after_task,
});
