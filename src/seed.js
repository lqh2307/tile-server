"use strict";

import { seedXYZTileDataFiles, printLog } from "./utils.js";
import { program } from "commander";
import fs from "node:fs";

/* Setup commands */
program
  .description("========== tile-server seed options ==========")
  .usage("tile-server seed [options]")
  .option("-n, --num_processes <num>", "Number of processes", "1")
  .option("-d, --data_dir <dir>", "Data directory", "data")
  .version(
    JSON.parse(fs.readFileSync("package.json", "utf8")).version,
    "-v, --version"
  )
  .showHelpAfterError()
  .parse(process.argv);

/**
 * Start seed data
 * @returns {Promise<void>}
 */
export async function startSeedData() {
  try {
    /* Load args */
    const argOpts = program.opts();
    const opts = {
      numProcesses: Number(argOpts.num_processes),
      dataDir: argOpts.data_dir,
    };

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
=========='-.____'.___ \\_____/___.-'____.-'==========
                       '=---='
            Buddha bless, server immortal
          Starting seed data with ${opts.numProcesses} processes
`
    );

    /* Read seed.json file */
    const seedData = JSON.parse(
      fs.readFileSync(`${opts.dataDir}/seed.json`, "utf8")
    );

    for (const id in seedData.datas) {
      try {
        await seedXYZTileDataFiles(
          seedData.datas[id].name,
          seedData.datas[id].description,
          seedData.datas[id].url,
          `${opts.dataDir}/xyzs/${id}`,
          seedData.datas[id].format,
          seedData.datas[id].bbox,
          seedData.datas[id].minZoom,
          seedData.datas[id].maxZoom,
          seedData.datas[id].scheme,
          seedData.datas[id].concurrency,
          false,
          seedData.datas[id].maxTry,
          seedData.datas[id].timeout
        );
      } catch (error) {
        printLog(
          "error",
          `Failed to seed data id ${id}: ${error}. Skipping...`
        );
      }
    }

    if (seedData.restartServerAfterSeed === true) {
      printLog("info", "Completed seeding data. Restaring server...");

      process.kill(
        JSON.parse(fs.readFileSync("server-info.json", "utf8")).mainPID,
        "SIGTERM"
      );
    } else {
      printLog("info", "Completed seeding data!");
    }
  } catch (error) {
    printLog("error", `Failed seed data: ${error}. Exited!`);
  }
}

startSeedData();
