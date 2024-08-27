"use strict";

import { startServer } from "./server.js";
import { printLog } from "./utils.js";
import { program } from "commander";
import chokidar from "chokidar";
import cluster from "cluster";
import path from "node:path";
import os from "os";

const configFilePath = path.resolve("data", "config.json");

/* Start server */
if (cluster.isPrimary === true) {
  /* Setup commands */
  program
    .description("========== tile-server startup options ==========")
    .usage("tile-server [options]")
    .option("-n, --num_threads <num>", "Number of threads", 1)
    .option(
      "-r, --restart_interval <num>",
      "Interval time to restart server",
      1000
    )
    .option("-k, --kill_interval <num>", "Interval time to kill server", 0)
    .version("1.0.0", "-v, --version")
    .showHelpAfterError()
    .parse(process.argv);

  /* Setup envs & events */
  process.env.UV_THREADPOOL_SIZE = Math.max(4, os.cpus().length * 2); // For libuv
  process.env.MAIN_PID = process.pid; // Store main PID

  process.on("SIGINT", () => {
    printLog("info", `Received "SIGINT" signal. Killing server...`);

    process.exit(0);
  });

  process.on("SIGTERM", () => {
    printLog("info", `Received "SIGTERM" signal. Restaring server...`);

    process.exit(1);
  });

  const options = {
    numThreads: Number(program.opts().num_threads),
    killInterval: Number(program.opts().kill_interval),
    restartInterval: Number(program.opts().restart_interval),
  };

  /* Fork servers */
  printLog("info", `Starting server with ${options.numThreads} processes...`);

  if (options.numThreads > 1) {
    for (let i = 0; i < options.numThreads; i++) {
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
    startServer(configFilePath);
  }

  /* Setup watch config file change */
  if (options.killInterval > 0) {
    printLog(
      "info",
      `Watch config file changes interval ${options.killInterval}ms to kill server`
    );

    chokidar
      .watch(configFilePath, {
        usePolling: true,
        awaitWriteFinish: true,
        interval: options.killInterval,
      })
      .on("change", () => {
        printLog("info", `Config file has changed. Killing server...`);

        process.exit(0);
      });
  } else if (options.restartInterval > 0) {
    printLog(
      "info",
      `Watch config file changes interval ${options.restartInterval}ms to restart server`
    );

    chokidar
      .watch(configFilePath, {
        usePolling: true,
        awaitWriteFinish: true,
        interval: options.restartInterval,
      })
      .on("change", () => {
        printLog("info", `Config file has changed. Restaring server...`);

        process.exit(1);
      });
  }

  /* Fork servers */
  printLog(
    "info",
    `========== Starting server with ${options.numThreads} threads... ==========`
  );

  if (options.numThreads > 1) {
    for (let i = 0; i < options.numThreads; i++) {
      cluster.fork();
    }

    cluster.on("exit", (worker, code, signal) => {
      printLog(
        "info",
        `Worker with PID = ${worker.process.pid} is died - Code: ${code} - Signal: ${signal}. Creating new one...`
      );

      cluster.fork();
    });
  } else {
    startServer();
  }
} else {
  startServer(configFilePath);
}
