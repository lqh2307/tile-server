"use strict";

import { readCleanUpFile, readSeedFile } from "./config.js";
import { removeOldCacheLocks } from "./utils.js";
import fsPromise from "node:fs/promises";
import { printLog } from "./logger.js";
import { program } from "commander";
import fs from "node:fs";
import os from "os";
import {
  cleanXYZTileDataFiles,
  seedXYZTileDataFiles,
} from "./seed_and_cleanup.js";

/* Setup commands */
program
  .description("========== tile-server seed and clean up options ==========")
  .usage("tile-server seed and clean up [options]")
  .option("-n, --num_processes <num>", "Number of processes", "1")
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

/**
 * Start task
 * @returns {Promise<void>}
 */
async function startTask() {
  /* Load args */
  const argOpts = program.opts();
  const opts = {
    numProcesses: Number(argOpts.num_processes),
    dataDir: argOpts.data_dir,
    cleanUp: argOpts.cleanup,
    seed: argOpts.seed,
    removeOldCacheLocks: argOpts.remove_old_cache_locks,
  };

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

  printLog(
    "info",
    `

                     _oo0oo_
                    o8888888o
                    88' . '88
                    (| -_- |)
                    0\\  =  /0
                  ___/'---'\\___
                .' \\\\|     |// '.
               / \\\\|||  :  |||// \\
              / _||||| -:- |||||_ \\
             |   | \\\\\\  -  /// |   |
             | \\_|  ''\\---/''  |_/ |
             \\  .-\\___ '-' ___/-.  /
           ___'. .'  /--.--\\  '. .'___
         .'' '< '.___\\_<|>_/___.' >' ''.
       | | :  '- \\'.;'\\ _ /';.'/ -'  : | |
       \\  \\ '_.   \\_ __\\ /__ _/   ._' /  /
          '-.____'.___ \\_____/___.-'____.-'==========
                     '=---='
          Buddha bless, server immortal
        Starting seed and clean up data with ${opts.numProcesses} processes
`
  );

  /* Remove old cache locks */
  if (opts.removeOldCacheLocks) {
    printLog(
      "info",
      `Starting remove old cache locks at "${opts.dataDir}/caches"...`
    );

    await removeOldCacheLocks(`${opts.dataDir}/caches`);
  }

  /* Read cleanup.json and seed.json files */
  printLog(
    "info",
    `Loading seed.json and cleanup.json files at "${opts.dataDir}"...`
  );

  if (!opts.cleanUp && !opts.seed) {
    printLog("info", `No seed or clean up task. Exited!`);
  }

  const [cleanUpData, seedData] = await Promise.all([
    readCleanUpFile(opts.dataDir),
    readSeedFile(opts.dataDir),
  ]);

  /* Run clean up task */
  if (opts.cleanUp) {
    try {
      printLog(
        "info",
        `Starting clean up ${Object.keys(cleanUpData.datas).length} datas...`
      );

      for (const id in cleanUpData.datas) {
        try {
          await cleanXYZTileDataFiles(
            `${opts.dataDir}/caches/xyzs/${id}`,
            seedData.datas[id].metadata.format,
            cleanUpData.datas[id].zooms,
            cleanUpData.datas[id].bbox,
            seedData.datas[id].concurrency,
            seedData.datas[id].maxTry,
            cleanUpData.datas[id].cleanUpBefore?.time ||
              cleanUpData.datas[id].cleanUpBefore?.day
          );
        } catch (error) {
          printLog(
            "error",
            `Failed to clean up data id "${id}": ${error}. Skipping...`
          );
        }
      }

      if (cleanUpData.restartServerAfterCleanUp === true) {
        printLog("info", "Completed cleaning up data. Restarting server...");

        process.kill(
          JSON.parse(await fsPromise.readFile("server-info.json", "utf8"))
            .mainPID,
          "SIGTERM"
        );
      } else {
        printLog("info", "Completed cleaning up data!");
      }
    } catch (error) {
      printLog("error", `Failed to clean up data: ${error}. Exited!`);
    }
  }

  /* Run seed task */
  if (opts.seed) {
    try {
      printLog(
        "info",
        `Starting seed ${Object.keys(seedData.datas).length} datas...`
      );

      for (const id in seedData.datas) {
        try {
          await seedXYZTileDataFiles(
            `${opts.dataDir}/caches/xyzs/${id}`,
            seedData.datas[id].metadata,
            seedData.datas[id].url,
            seedData.datas[id].bbox,
            seedData.datas[id].zooms,
            seedData.datas[id].concurrency,
            seedData.datas[id].maxTry,
            seedData.datas[id].timeout,
            seedData.datas[id].refreshBefore?.time ||
              seedData.datas[id].refreshBefore?.day ||
              seedData.datas[id].refreshBefore?.md5
          );
        } catch (error) {
          printLog(
            "error",
            `Failed to seed data id "${id}": ${error}. Skipping...`
          );
        }
      }

      if (seedData.restartServerAfterSeed === true) {
        printLog("info", "Completed seeding data. Restarting server...");

        process.kill(
          JSON.parse(await fsPromise.readFile("server-info.json", "utf8"))
            .mainPID,
          "SIGTERM"
        );
      } else {
        printLog("info", "Completed seeding data!");
      }
    } catch (error) {
      printLog("error", `Failed to seed data: ${error}. Exited!`);
    }
  }
}

startTask();
