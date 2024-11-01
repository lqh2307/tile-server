"use strict";

import { createXYZMetadataFile } from "./xyz.js";
import fsPromise from "node:fs/promises";
import { program } from "commander";
import pLimit from "p-limit";
import path from "node:path";
import fs from "node:fs";
import os from "os";
import {
  removeEmptyFolders,
  getTilesFromBBox,
  calculateMD5,
  isExistFile,
  findFiles,
  printLog,
  getData,
  retry,
} from "./utils.js";

/* Setup commands */
program
  .description("========== tile-server seed options ==========")
  .usage("tile-server seed [options]")
  .option("-n, --num_processes <num>", "Number of processes", "1")
  .option("-d, --data_dir <dir>", "Data directory", "data")
  .option("-c, --cleanup", "Run cleanup task to remove specified tiles")
  .option("-s, --seed", "Run seed task to download tiles")
  .version(
    JSON.parse(fs.readFileSync("package.json", "utf8")).version,
    "-v, --version"
  )
  .showHelpAfterError()
  .parse(process.argv);

/**
 * Download all xyz tile data files in a specified bounding box and zoom levels
 * @param {string} name Source data
 * @param {string} description Source description
 * @param {string} tileURL Tile URL to download
 * @param {string} outputFolder Folder to store downloaded tiles
 * @param {"jpeg"|"jpg"|"pbf"|"png"|"webp"|"gif"} format Tile format
 * @param {Array<number>} bounds Bounding box in format [lonMin, latMin, lonMax, latMax] in EPSG:4326
 * @param {Array<number>} center Center in format [lon, lat, zoom] in EPSG:4326
 * @param {Array<number>} zooms Array of specific zoom levels
 * @param {"xyz"|"tms"} scheme Tile scheme
 * @param {number} concurrency Concurrency download
 * @param {boolean} overwrite Overwrite exist file
 * @param {number} maxTry Number of retry attempts on failure
 * @param {number} timeout Timeout in milliseconds
 * @returns {Promise<void>}
 */
export async function seedXYZTileDataFiles(
  name,
  description,
  tileURL,
  outputFolder,
  format,
  bounds = [-180, -85.051129, 180, 85.051129],
  center = [0, 0, 11],
  zooms = [
    0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20,
    21, 22,
  ],
  scheme = "xyz",
  concurrency = os.cpus().length,
  overwrite = true,
  maxTry = 5,
  timeout = 60000
) {
  const tilesSummary = getTilesFromBBox(bounds, zooms, scheme);
  const limitConcurrencyDownload = pLimit(concurrency);
  let hashs = {};

  try {
    hashs = JSON.parse(await fsPromise.readFile(`${outputFolder}/md5.json`));
  } catch (error) {}

  printLog(
    "info",
    `Downloading ${tilesSummary.length} tile data files - BBox [${bounds.join(
      ", "
    )}] - Zoom levels [${zooms.join(", ")}]...`
  );

  const tilePromises = [];

  for (const z in tilesSummary) {
    for (let x = tilesSummary[z].x[0]; x <= tilesSummary[z].x[1]; x++) {
      for (let y = tilesSummary[z].y[0]; y <= tilesSummary[z].y[1]; y++) {
        tilePromises.push(
          limitConcurrencyDownload(async () => {
            const url = tileURL.replace("/{z}/{x}/{y}", `/${z}/${x}/${y}`);
            const filePath = `${outputFolder}/${z}/${x}/${y}.${format}`;

            try {
              if (
                overwrite === false &&
                (await isExistFile(filePath)) === true
              ) {
                printLog(
                  "info",
                  `Tile data file exists. Skipping download from ${url}...`
                );
              } else {
                printLog("info", `Downloading tile data file from ${url}...`);

                await retry(async () => {
                  // Get data
                  const response = await getData(url, timeout);

                  // Store data to file
                  await fsPromise.mkdir(path.dirname(filePath), {
                    recursive: true,
                  });
                  await fsPromise.writeFile(filePath, response.data);

                  // Store data md5 hash
                  if (response.headers["Etag"]) {
                    hashs[`${z}/${x}/${y}`] = response.headers["Etag"];
                  } else {
                    hashs[`${z}/${x}/${y}`] = calculateMD5(response.data);
                  }
                }, maxTry);
              }
            } catch (error) {
              printLog("error", `Failed to download tile data file: ${error}`);

              // Remove error tile data file
              await fsPromise.rm(filePath, {
                force: true,
              });
            }
          })
        );
      }
    }
  }

  await createXYZMetadataFile(
    outputFolder,
    name,
    description,
    format,
    bounds,
    center,
    Math.min(...zooms),
    Math.max(...zooms),
    "overlay",
    scheme
  );

  await fsPromise.writeFile(
    `${outputFolder}/md5.json`,
    JSON.stringify(hashs, null, 2)
  );

  await removeEmptyFolders(outputFolder);
}

/**
 * Remove all xyz tile data files in a specified zoom levels
 * @param {string} outputFolder Folder to store downloaded tiles
 * @param {"jpeg"|"jpg"|"pbf"|"png"|"webp"|"gif"} format Tile format
 * @param {Array<number>} zooms Array of specific zoom levels
 * @returns {Promise<void>}
 */
export async function removeXYZTileDataFiles(
  outputFolder,
  format,
  zooms = [
    0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20,
    21, 22,
  ]
) {
  let hashs = {};

  try {
    hashs = JSON.parse(await fsPromise.readFile(`${outputFolder}/md5.json`));
  } catch (error) {}

  await Promise.all(
    zooms.map(async (zoom) => {
      const files = await findFiles(
        `${outputFolder}/${zoom}`,
        new RegExp(`^\\d+/\\d+\\.${format}$`),
        true
      );

      files.forEach((file) => {
        delete hashs[file.split(".")[0]];
      });

      await fsPromise.writeFile(
        `${outputFolder}/md5.json`,
        JSON.stringify(hashs, null, 2)
      );

      await fsPromise.rm(`${outputFolder}/${zoom}`, {
        force: true,
        recursive: true,
      });
    })
  );
}

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

  if (opts.cleanUp) {
    try {
      /* Read cleanup.json file */
      const cleanUpData = JSON.parse(
        fs.readFileSync(`${opts.dataDir}/cleanup.json`, "utf8")
      );

      for (const id in cleanUpData.datas) {
        try {
          await removeXYZTileDataFiles(
            `${opts.dataDir}/xyzs/${id}`,
            cleanUpData.datas[id].format,
            cleanUpData.datas[id].zooms
          );
        } catch (error) {
          printLog(
            "error",
            `Failed to clean up data id ${id}: ${error}. Skipping...`
          );
        }
      }

      if (cleanUpData.restartServerAfterSeed === true) {
        printLog("info", "Completed cleaning up data. Restaring server...");

        process.kill(
          JSON.parse(fs.readFileSync("server-info.json", "utf8")).mainPID,
          "SIGTERM"
        );
      } else {
        printLog("info", "Completed cleaning up data!");
      }
    } catch (error) {
      printLog("error", `Failed clean data: ${error}. Exited!`);
    }
  }

  if (opts.seed) {
    try {
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
            seedData.datas[id].bounds,
            seedData.datas[id].center,
            seedData.datas[id].zooms,
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
}

startTask();
