"use strict";

import os from "os";
import fs from "node:fs";
import path from "node:path";
import { startServer } from "./server.js";
import { program } from "commander";
import { printLog } from "./utils.js";

const packageJSON = JSON.parse(
  fs.readFileSync(path.resolve("package.json"), "utf8")
);

program
  .description("===== Tile server startup options =====")
  .usage("tile-server [options]")
  .option(
    "-d, --data-dir <path>",
    "data dir path",
    packageJSON.params.defaultDataDir
  )
  .option(
    "-p, --port <port>",
    "listening port",
    packageJSON.params.defaultListeningPort
  )
  .option(
    "-r, --restart <interval>",
    "monitor config file changes to restart server"
  )
  .option("-k, --kill <interval>", "monitor config file changes to kill server")
  .version(packageJSON.params.version, "-v, --version")
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
  port: Number(opts.port),
  dataDir: path.resolve(opts.dataDir),
  restart: Number(opts.restart),
  kill: Number(opts.kill),
});
