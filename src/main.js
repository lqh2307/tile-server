"use strict";

import os from "os";
import fs from "node:fs";
import path from "node:path";
import { server } from "./server.js";
import { program } from "commander";

const packageJson = JSON.parse(
  fs.readFileSync(path.resolve("package.json"), "utf8")
);

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
  .version(packageJson.version, "-v, --version")
  .showHelpAfterError();

program.parse(process.argv);

process.env.UV_THREADPOOL_SIZE = Math.ceil(Math.max(4, os.cpus().length * 1.5)); // For libuv

const startServer = (opts) => {
  server({
    port: opts.port,
    configFilePath: opts.configFilePath,
    autoRefresh: opts.autoRefresh,
  });
};

startServer(program.opts());
