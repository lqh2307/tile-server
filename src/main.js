"use strict";

import os from "os";
import fs from "node:fs";
import path from "node:path";
import { newServer } from "./server.js";
import { program } from "commander";
import { logInfo } from "./utils.js";

program
  .description("tile-server startup options")
  .usage("tile-server [options]")
  .option(
    "-c, --config-file-path <config file path>",
    "Config file path",
    "data/config.json"
  )
  .option("-p, --port <port>", "Port", 8080, parseInt)
  .option(
    "-a, --auto-refresh",
    "Auto refresh server after changing config file"
  )
  .version(
    JSON.parse(fs.readFileSync(path.resolve("package.json"), "utf8")).version,
    "-v, --version"
  )
  .showHelpAfterError();

program.parse(process.argv);

process.env.UV_THREADPOOL_SIZE = Math.ceil(Math.max(4, os.cpus().length * 1.5)); // For libuv
process.on("SIGINT", () => {
  logInfo("Killed server!");

  process.exit(0);
});
process.on("SIGTERM", () => {
  logInfo("Killed server!");

  process.exit(0);
});

const startServer = (opts) => {
  newServer({
    port: opts.port,
    configFilePath: opts.configFilePath,
    autoRefresh: opts.autoRefresh,
  });
};

startServer(program.opts());
