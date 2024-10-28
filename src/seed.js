"use strict";

import { downloadTileDataFilesFromBBox, printLog } from "./utils.js";
import { printLog } from "./utils.js";
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
      await fsPromise.readFile(`${dataDir}/config.json`, "utf8")
    );

    for (const id in seedData.datas) {
      try {
        let scheme;
        let directory;

        if (seedData.datas[id].xyz !== undefined) {
          scheme = "xyz";
          directory = `${dataDir}/xyzs/${seedData.datas[id].xyz.directory}`;
        } else if (seedData.datas[id].tms !== undefined) {
          scheme = "tms";
          directory = `${dataDir}/xyzs/${seedData.datas[id].tms.directory}`;
        }

        await downloadTileDataFilesFromBBox(
          seedData.datas[id].url,
          directory,
          seedData.datas[id].format,
          seedData.datas[id].bbox,
          seedData.datas[id].min_zoom,
          seedData.datas[id].max_zoom,
          scheme,
          10,
          false,
          5,
          60000 // 1 min
        );
      } catch (error) {
        printLog("error", `Failed seed data id ${id}: ${error}. Skipping...`);
      }
    }

    printLog("info", `Completed seeding data!`);
  } catch (error) {
    printLog("error", `Failed seed data: ${error}. Exited!`);
  }
}

startSeedData();
