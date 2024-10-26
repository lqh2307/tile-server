"use strict";

import { startServer } from "./server.js";
import { printLog } from "./utils.js";
import { program } from "commander";
import chokidar from "chokidar";
import cluster from "cluster";
import fs from "node:fs";
import os from "os";

/* Setup commands */
program
  .description("========== tile-server startup options ==========")
  .usage("tile-server [options]")
  .option("-n, --num_processes <num>", "Number of processes", "1")
  .option(
    "-r, --restart_interval <num>",
    "Interval time to restart server",
    "1000"
  )
  .option("-k, --kill_interval <num>", "Interval time to kill server", "0")
  .option("-d, --data_dir <dir>", "Data directory", "data")
  .version(
    JSON.parse(fs.readFileSync("package.json", "utf8")).version,
    "-v, --version"
  )
  .showHelpAfterError()
  .parse(process.argv);

/* Load args */
const argOpts = program.opts();

const opts = {
  numProcesses: Number(argOpts.num_processes),
  killInterval: Number(argOpts.kill_interval),
  restartInterval: Number(argOpts.restart_interval),
  dataDir: argOpts.data_dir,
};

/* Start server */
if (cluster.isPrimary === true) {
  /* Setup envs & events */
  process.env.UV_THREADPOOL_SIZE = Math.max(4, os.cpus().length); // For libuv
  process.env.MAIN_PID = process.pid; // Store main PID in other processes

  process.on("SIGINT", () => {
    printLog("info", `Received "SIGINT" signal. Killing server...`);

    process.exit(0);
  });

  process.on("SIGTERM", () => {
    printLog("info", `Received "SIGTERM" signal. Restaring server...`);

    process.exit(1);
  });

  /* Fork servers */
  printLog(
    "info",
    `========== Starting server with ${opts.numProcesses} processes... ==========`
  );

  /* Buddha bless */
  printLog(
    "info",
    `
                  _oo0oo_
                 o8888888o
                 88' . '88
                 (| -_- |)
                 0\  =  /0
               ___/'---'\___
             .' \\|     |// '.
            / \\|||  :  |||// \
           / _||||| -:- |||||_ \
          |   | \\\  -  /// |   |
          | \_|  ''\---/''  |_/ |
          \  .-\___ '-' ___/-.  /
        ___'. .'  /--.--\  '. .'___
      .'' '< '.___\_<|>_/___.' >' ''.
    | | :  '- \'.;'\ _ /';.'/ -'  : | |
    \  \ '_.   \_ __\ /__ _/   ._' /  /
====='-.____'.___ \_____/___.-'____.-'=====
                  '=---='
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
       Buddha bless, server immortal
`
  );

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
        printLog("info", `Config file has changed. Killing server...`);

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
        printLog("info", `Config file has changed. Restaring server...`);

        process.exit(1);
      });
  }
} else {
  startServer(opts.dataDir);
}
