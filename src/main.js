"use strict";

import os from "os";
import fs from "node:fs";
import path from "node:path";
import { program } from "commander";
import { startServer } from "./server.js";
import { printLog } from "./utils.js";

const packageJSON = JSON.parse(
  fs.readFileSync(path.resolve("package.json"), "utf8")
);

program
  .description("===== Tile server startup options =====")
  .usage("tile-server [options]")
  .option("-d, --data-dir <path>", "data directory path", "data")
  .version(packageJSON.version, "-v, --version")
  .showHelpAfterError();

process.env.UV_THREADPOOL_SIZE = Math.ceil(Math.max(4, os.cpus().length * 1.5)); // For libuv

process.on("SIGINT", () => {
  printLog("info", `Received "SIGINT" signal. Killed server!`);

  process.exit(0);
});
process.on("SIGTERM", () => {
  printLog("info", `Received "SIGTERM" signal. Killed server!`);

  process.exit(0);
});

program.parse(process.argv);

const opts = program.opts();

startServer({
  dataDir: path.resolve(opts.dataDir),
});
