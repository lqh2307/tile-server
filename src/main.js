"use strict";

import { removeOldCacheLocks, updateServerInfoFile } from "./utils.js";
import { startServer } from "./server.js";
import { printLog } from "./logger.js";
import { program } from "commander";
import chokidar from "chokidar";
import cluster from "cluster";
import fs from "node:fs";
import os from "os";

/* Setup commands */
program
  .description("========== tile-server startup options ==========")
  .usage("tile-server server [options]")
  .option("-n, --num_processes <num>", "Number of processes", "1")
  .option(
    "-r, --restart_interval <num>",
    "Interval time to restart server",
    "1000"
  )
  .option("-k, --kill_interval <num>", "Interval time to kill server", "0")
  .option("-d, --data_dir <dir>", "Data directory", "data")
  .option(
    "-rm, --remove_old_cache_locks",
    "Remove old cache locks before run server"
  )
  .option("-no, --no_start_server", "No start server")
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

    printLog("info", `Starting server with ${opts.numProcesses} processes...`);

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

    if (opts.noStartServer) {
      printLog("info", `No start server. Exited!`);

      return;
    }

    /* Store main pid */
    await updateServerInfoFile("server-info.json", {
      mainPID: Number(process.pid),
    });

    /* Remove old cache locks */
    if (opts.removeOldCacheLocks) {
      printLog(
        "info",
        `Starting remove old cache locks at "${opts.dataDir}/caches"...`
      );

      await removeOldCacheLocks(`${opts.dataDir}/caches`);
    }

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

    /* Fork servers */
    if (opts.numProcesses > 1) {
      for (let i = 0; i < opts.numProcesses; i++) {
        cluster.fork();
      }

      cluster.on("exit", (worker, code, signal) => {
        printLog(
          "info",
          `Process with PID = ${worker.process.pid} is died - Code: ${code} - Signal: ${signal}. Creating new one...`
        );

        cluster.fork();
      });
    } else {
      startServer(opts.dataDir);
    }
  } else {
    startServer(opts.dataDir);
  }
}

startClusterServer({
  numProcesses: Number(argOpts.num_processes),
  killInterval: Number(argOpts.kill_interval),
  restartInterval: Number(argOpts.restart_interval),
  dataDir: argOpts.data_dir,
  removeOldCacheLocks: argOpts.remove_old_cache_locks,
  noStartServer: argOpts.no_start_server,
});
