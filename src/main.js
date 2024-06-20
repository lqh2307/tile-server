"use strict";

import os from "os";
import fs from "node:fs";
import path from "node:path";
import { newServer } from "./server.js";
import { program } from "commander";
import { printLog } from "./utils.js";

const packageJSON = JSON.parse(
  fs.readFileSync(path.resolve("package.json"), "utf8")
);

program
  .description("===== Tile server startup options =====")
  .usage("tile-server [options]")
  .option("-d, --data-dir <path>", "data dir path", "data")
  .option("-p, --port <port>", "listening port", "8080")
  .option(
    "-r, --reload <interval>",
    "monitor config file changes to reload server",
    "0"
  )
  .option(
    "-k, --kill <interval>",
    "monitor config file changes to kill server",
    "0"
  )
  .version(packageJSON.version, "-v, --version")
  .showHelpAfterError();

program.parse(process.argv);

process.env.UV_THREADPOOL_SIZE = Math.ceil(Math.max(4, os.cpus().length * 1.5)); // For libuv

process.on("SIGINT", () => {
  printLog("info", "Killed server!");

  process.exit(0);
});
process.on("SIGTERM", () => {
  printLog("info", "Killed server!");

  process.exit(0);
});

const opts = program.opts();

newServer({
  port: Number(opts.port),
  dataDir: path.resolve(opts.dataDir),
  reload: Number(opts.reload),
  kill: Number(opts.kill),
});
