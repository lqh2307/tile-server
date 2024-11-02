"use strict";

import { createXYZMD5File, createXYZMetadataFile } from "./xyz.js";
import fsPromise from "node:fs/promises";
import { program } from "commander";
import pLimit from "p-limit";
import path from "node:path";
import fs from "node:fs";
import os from "os";
import {
  getTileBoundsFromBBox,
  removeEmptyFolders,
  calculateMD5,
  isExistFile,
  printLog,
  getData,
  retry,
} from "./utils.js";

/* Setup commands */
program
  .description("========== tile-server seed and clean up options ==========")
  .usage("tile-server seed and clean up [options]")
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

/* Setup envs & events */
process.env.UV_THREADPOOL_SIZE = Math.max(4, os.cpus().length); // For libuv

process.on("SIGINT", () => {
  printLog("info", `Received "SIGINT" signal. Killing seed and clean up...`);

  process.exit(0);
});

process.on("SIGTERM", () => {
  printLog("info", `Received "SIGTERM" signal. Restaring seed and clean up...`);

  process.exit(1);
});

/**
 * Download all xyz tile data files in a specified bounding box and zoom levels
 * @param {string} name Source data name
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
  printLog(
    "info",
    `Downloading tile data files with Zoom levels [${zooms.join(
      ", "
    )}] - BBox [${bounds.join(", ")}]...`
  );

  // Read md5.json file
  let hashs = {};

  try {
    hashs = JSON.parse(await fsPromise.readFile(`${outputFolder}/md5.json`));
  } catch (error) {}

  // Download file
  const tilesSummary = getTileBoundsFromBBox(bounds, zooms, scheme);
  const limitConcurrencyDownload = pLimit(concurrency);
  const tilePromises = [];

  for (const z in tilesSummary) {
    for (let x = tilesSummary[z].x[0]; x <= tilesSummary[z].x[1]; x++) {
      for (let y = tilesSummary[z].y[0]; y <= tilesSummary[z].y[1]; y++) {
        tilePromises.push(
          limitConcurrencyDownload(async () => {
            const tileName = `${z}/${x}/${y}`;
            const filePath = `${outputFolder}/${tileName}.${format}`;
            const url = tileURL.replace("/{z}/{x}/{y}", tileName);

            try {
              if (
                overwrite === false &&
                (await isExistFile(filePath)) === true
              ) {
                printLog(
                  "info",
                  `Tile data file is exists. Skipping download from ${url}...`
                );
              } else {
                printLog("info", `Downloading tile data file from ${url}...`);

                await retry(async () => {
                  // Get data
                  const response = await getData(url, timeout);

                  // Skip with 204 error code
                  if (response.status === 204) {
                    printLog(
                      "warning",
                      `Failed to download tile data file: Failed to request ${url} with status code: ${response.status} - ${response.statusText}. Skipping`
                    );

                    return;
                  }

                  // Store data to file
                  await fsPromise.mkdir(path.dirname(filePath), {
                    recursive: true,
                  });

                  await fsPromise.writeFile(filePath, response.data);

                  // Store data md5 hash
                  if (response.headers["Etag"]) {
                    hashs[tileName] = response.headers["Etag"];
                  } else {
                    hashs[tileName] = calculateMD5(response.data);
                  }
                }, maxTry);
              }
            } catch (error) {
              printLog(
                "error",
                `Failed to download tile data file "${filePath}": ${error}`
              );

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

  await Promise.all(tilePromises);

  // Create metadata.json file
  await createXYZMetadataFile(outputFolder, {
    name: name || "Unknown",
    description: description || "Unknown",
    version: "1.0.0",
    format: format || "png",
    bounds: bounds || [-180, -85.051129, 180, 85.051129],
    center: center || [0, 0, 11],
    minzoom: Math.min(...zooms),
    maxzoom: Math.max(...zooms),
    scheme: scheme || "xyz",
    time: new Date().toISOString().split(".")[0],
  });

  // Create md5.json file
  await createXYZMD5File(outputFolder, hashs);

  // Remove folders if empty
  await removeEmptyFolders(outputFolder);
}

/**
 * Remove all xyz tile data files in a specified zoom levels
 * @param {string} outputFolder Folder to store downloaded tiles
 * @param {"jpeg"|"jpg"|"pbf"|"png"|"webp"|"gif"} format Tile format
 * @param {Array<number>} zooms Array of specific zoom levels
 * @param {Array<number>} bounds Bounding box in format [lonMin, latMin, lonMax, latMax] in EPSG:4326
 * @param {string} cleanUpBefore Date string in format "YYYY-MM-DDTHH:mm:ss" before which files should be deleted
 * @returns {Promise<void>}
 */
export async function cleanXYZTileDataFiles(
  outputFolder,
  format,
  zooms,
  bounds,
  cleanUpBefore
) {
  if (cleanUpBefore) {
    printLog(
      "info",
      `Cleaning up tile data files with Zoom levels [${zooms.join(
        ", "
      )}] - BBox [${bounds.join(", ")}] - Before ${cleanUpBefore}...`
    );

    cleanUpBefore = new Date(cleanUpBefore).getTime();
  } else {
    printLog(
      "info",
      `Cleaning up tile data files with Zoom levels [${zooms.join(
        ", "
      )}] - BBox [${bounds.join(", ")}]...`
    );
  }

  // Read md5.json file
  let hashs = {};

  try {
    hashs = JSON.parse(await fsPromise.readFile(`${outputFolder}/md5.json`));
  } catch (error) {}

  // Remove files
  const tilesSummary = getTileBoundsFromBBox(bounds, zooms, scheme);
  const tilePromises = [];

  for (const z in tilesSummary) {
    for (let x = tilesSummary[z].x[0]; x <= tilesSummary[z].x[1]; x++) {
      for (let y = tilesSummary[z].y[0]; y <= tilesSummary[z].y[1]; y++) {
        tilePromises.push(async () => {
          const tileName = `${z}/${x}/${y}`;
          const filePath = `${outputFolder}/${tileName}.${format}`;

          try {
            if (cleanUpBefore) {
              const stats = await fsPromise.stat(filePath);

              if (!stats.ctimeMs || stats.ctimeMs < cleanUpBefore) {
                await fsPromise.rm(filePath, {
                  force: true,
                });

                delete hashs[tileName];
              }
            } else {
              await fsPromise.rm(filePath, {
                force: true,
              });

              delete hashs[tileName];
            }
          } catch (error) {
            printLog(
              "error",
              `Failed to remove tile data file "${filePath}": ${error}`
            );
          }
        });
      }
    }
  }

  await Promise.all(tilePromises);

  // Update md5.json file
  await createXYZMD5File(outputFolder, hashs);

  // Remove parent folder if empty
  await fsPromise.rm(outputFolder, {
    force: true,
    recursive: true,
  });
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

  /* Read cleanup.json file */
  const cleanUpData = JSON.parse(
    await fsPromise.readFile(`${opts.dataDir}/cleanup.json`, "utf8")
  );

  /* Read seed.json file */
  const seedData = JSON.parse(
    await fsPromise.readFile(`${opts.dataDir}/seed.json`, "utf8")
  );

  if (opts.cleanUp) {
    try {
      for (const id in cleanUpData.datas) {
        try {
          await cleanXYZTileDataFiles(
            `${opts.dataDir}/xyzs/${id}`,
            cleanUpData.datas[id].zooms || seedData.datas[id].zooms,
            seedData.datas[id].format,
            cleanUpData.datas[id].bounds || seedData.datas[id].bounds,
            cleanUpData.datas[id].cleanUpBefore.time ||
              seedData.datas[id].refreshBefore.time
          );
        } catch (error) {
          printLog(
            "error",
            `Failed to clean up data id "${id}": ${error}. Skipping...`
          );
        }
      }

      if (cleanUpData.restartServerAfterCleanUp === true) {
        printLog("info", "Completed cleaning up data. Restaring server...");

        process.kill(
          JSON.parse(await fsPromise.readFile("server-info.json", "utf8"))
            .mainPID,
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
            `Failed to seed data id "${id}": ${error}. Skipping...`
          );
        }
      }

      if (seedData.restartServerAfterSeed === true) {
        printLog("info", "Completed seeding data. Restaring server...");

        process.kill(
          JSON.parse(await fsPromise.readFile("server-info.json", "utf8"))
            .mainPID,
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