"use strict";

import { startServer } from "./server.js";
import { printLog } from "./utils.js";
import os from "os";

/* Setup envs & events */
process.env.UV_THREADPOOL_SIZE = Math.ceil(Math.max(4, os.cpus().length * 1.5)); // For libuv

process.on("SIGINT", () => {
  printLog("info", `Received "SIGINT" signal. Killed server!`);

  process.exit(0);
});

process.on("SIGTERM", () => {
  printLog("info", `Received "SIGTERM" signal. Killed server!`);

  process.exit(0);
});

/* Start server */
startServer();
