"use strict";

import os from "os";
import fs from "node:fs";
import path from "node:path";
import { newServer } from "./server.js";
import { program } from "commander";
import { printLog } from "./utils.js";

program
  .description("tile-server startup options")
  .usage("tile-server [options]")
  .option("-c, --config <path>", "Config file path", "data/config.json")
  .option("-p, --port <port>", "Port", 8080, parseInt)
  .option("-r, --refresh", "Refresh server after changing config file")
  .option("-k, --kill", "Kill server after changing config file")
  .version(
    JSON.parse(fs.readFileSync(path.resolve("package.json"), "utf8")).version,
    "-v, --version"
  )
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
    config: opts.config,
    refresh: opts.refresh,
    kill: opts.kill,
  });
};

startServer(program.opts());
