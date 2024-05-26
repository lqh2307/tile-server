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
  .description("tile-server startup options")
  .usage("tile-server [options]")
  .option("-d, --data-dir <path>", "Data dir path", "data")
  .option("-p, --port <port>", "Port", 8080, parseInt)
  .option("-r, --refresh", "Refresh server after changing config file", false)
  .option("-k, --kill", "Kill server after changing config file", false)
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

const startServer = (opts) => {
  newServer({
    port: opts.port,
    dataDir: opts.dataDir,
    refresh: opts.refresh,
    kill: opts.kill,
  });
};

startServer(program.opts());
