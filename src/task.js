"use strict";

import { startTask } from "./seed_and_cleanup.js";
import { printLog } from "./logger.js";
import { program } from "commander";
import fs from "node:fs";
import os from "os";

/* Setup commands */
program
  .description("========== tile-server seed and clean up options ==========")
  .usage("tile-server seed and clean up [options]")
  .option("-d, --data_dir <dir>", "Data directory", "data")
  .option("-c, --cleanup", "Run cleanup task to remove specified tiles")
  .option("-s, --seed", "Run seed task to download tiles")
  .option(
    "-rm, --remove_old_cache_locks",
    "Remove old cache locks before run task"
  )
  .version(
    JSON.parse(fs.readFileSync("package.json", "utf8")).version,
    "-v, --version"
  )
  .showHelpAfterError()
  .parse(process.argv);

/* Load args */
const argOpts = program.opts();

/* Setup envs & events */
process.env.UV_THREADPOOL_SIZE = Math.max(4, os.cpus().length); // For libuv

process.on("SIGINT", () => {
  printLog("info", `Received "SIGINT" signal. Killing seed and clean up...`);

  process.exit(0);
});

process.on("SIGTERM", () => {
  printLog(
    "info",
    `Received "SIGTERM" signal. Restarting seed and clean up...`
  );

  process.exit(1);
});

startTask({
  dataDir: argOpts.data_dir,
  cleanUp: argOpts.cleanup,
  seed: argOpts.seed,
  removeOldCacheLocks: argOpts.remove_old_cache_locks,
});
