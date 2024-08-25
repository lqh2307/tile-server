"use strict";

import { startServer } from "./server.js";
import { printLog } from "./utils.js";
import { program } from "commander";
import cluster from "cluster";
import os from "os";

/* Setup commands */
program.description("tile-server startup options").usage("tile-server [options]").option("--num_threads <num>", "Number of threads", 1).version("1.0.0", "-v, --version").showHelpAfterError().parse(process.argv);

const numThreads = Number(program.opts().num_threads);

/* Setup envs & events */
process.env.UV_THREADPOOL_SIZE = Math.max(4, os.cpus().length * 2); // For libuv

process.on("SIGINT", () => {
  printLog("info", `Received "SIGINT" signal. Killed server!`);

  process.exit(0);
});

process.on("SIGTERM", () => {
  printLog("info", `Received "SIGTERM" signal. Killed server!`);

  process.exit(0);
});

/* Start server */
if (cluster.isMaster) {
  printLog("info", `Starting server with ${numThreads} threads...`);

  for (let i = 0; i < numThreads; i++) {
    cluster.fork();
  }

  cluster.on("exit", (worker) => {
    printLog("info", `Worker ${worker.process.pid} is died. Creating new one...`);

    cluster.fork();
  });
} else {
  startServer(cluster.worker.id);
}
