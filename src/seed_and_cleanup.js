"use strict";

import fsPromise from "node:fs/promises";
import { program } from "commander";
import pLimit from "p-limit";
import fs from "node:fs";
import os from "os";
import {
  updateXYZMetadataFileWithLock,
  updateXYZMD5FileWithLock,
  downloadXYZTileDataFile,
  removeXYZTileDataFile,
} from "./xyz.js";
import {
  getTileBoundsFromBBox,
  removeEmptyFolders,
  printLog,
  getData,
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
  printLog(
    "info",
    `Received "SIGTERM" signal. Restarting seed and clean up...`
  );

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
 * @param {Array<object>} vector_layers Vector layers
 * @param {object} tilestats Tile stats
 * @param {number} concurrency Concurrency download
 * @param {number} maxTry Number of retry attempts on failure
 * @param {number} timeout Timeout in milliseconds
 * @param {string|number|boolean} refreshBefore Date string in format "YYYY-MM-DDTHH:mm:ss" or number of days before which files should be refreshed
 * @returns {Promise<void>}
 */
export async function seedXYZTileDataFiles(
  name = "Unknown",
  description = "Unknown",
  tileURL,
  outputFolder,
  format = "png",
  bounds = [-180, -85.051129, 180, 85.051129],
  center = [0, 0, 11],
  zooms = [
    0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20,
    21, 22,
  ],
  vector_layers,
  tilestats,
  concurrency = os.cpus().length,
  maxTry = 5,
  timeout = 60000,
  refreshBefore
) {
  let refreshTimestamp;
  let log = `Downloading tile data files with:\n\tZoom levels [${zooms.join(
    ", "
  )}]\n\tBBox [${bounds.join(", ")}]`;

  if (typeof refreshBefore === "string") {
    refreshTimestamp = new Date(refreshBefore).getTime();

    log += `\n\tBefore ${refreshBefore}`;
  } else if (typeof refreshBefore === "number") {
    const now = new Date();

    refreshTimestamp = now.setDate(now.getDate() - refreshBefore);

    log += `\n\tOld than ${refreshBefore} days`;
  } else if (typeof refreshBefore === "boolean") {
    refreshTimestamp = true;

    log += `\n\tBefore check MD5`;
  }

  printLog("info", log);

  // Download file
  const tilesSummary = getTileBoundsFromBBox(bounds, zooms, "xyz");
  const limitConcurrencyDownload = pLimit(concurrency);
  const tilePromises = [];
  const hashs = {};

  for (const z in tilesSummary) {
    for (let x = tilesSummary[z].x[0]; x <= tilesSummary[z].x[1]; x++) {
      for (let y = tilesSummary[z].y[0]; y <= tilesSummary[z].y[1]; y++) {
        tilePromises.push(
          limitConcurrencyDownload(async () => {
            const tileName = `${z}/${x}/${y}`;
            const filePath = `${outputFolder}/${tileName}.${format}`;
            const url = tileURL.replaceAll("{z}/{x}/{y}", tileName);

            try {
              const stats = await fsPromise.stat(filePath);

              if (refreshTimestamp !== undefined) {
                if (refreshTimestamp === true) {
                  const md5URL = tileURL.replaceAll(
                    "{z}/{x}/{y}",
                    `md5/${tileName}`
                  );

                  const response = await getData(md5URL, timeout);

                  if (response.headers["Etag"] !== hashs[tileName]) {
                    await downloadXYZTileDataFile(
                      url,
                      outputFolder,
                      tileName,
                      format,
                      maxTry,
                      timeout,
                      hashs
                    );
                  }
                } else if (
                  stats.ctimeMs === undefined ||
                  stats.ctimeMs < refreshTimestamp
                ) {
                  await downloadXYZTileDataFile(
                    url,
                    outputFolder,
                    tileName,
                    format,
                    maxTry,
                    timeout,
                    hashs
                  );
                }
              }
            } catch (error) {
              await downloadXYZTileDataFile(
                url,
                outputFolder,
                tileName,
                format,
                maxTry,
                timeout,
                hashs
              );
            }
          })
        );
      }
    }
  }

  await Promise.all(tilePromises);

  // Update metadata.json file
  await updateXYZMetadataFileWithLock(
    outputFolder,
    {
      name: name,
      description: description,
      version: "1.0.0",
      format: format,
      bounds: bounds,
      center: center,
      type: "overlay",
      minzoom: Math.min(...zooms),
      maxzoom: Math.max(...zooms),
      vector_layers: vector_layers,
      tilestats: tilestats,
    },
    300000 // 5 mins
  );

  // Update md5.json file
  await updateXYZMD5FileWithLock(
    outputFolder,
    hashs,
    300000 // 5 mins
  );

  // Remove folders if empty
  await removeEmptyFolders(outputFolder);
}

/**
 * Remove all xyz tile data files in a specified zoom levels
 * @param {string} outputFolder Folder to store downloaded tiles
 * @param {"jpeg"|"jpg"|"pbf"|"png"|"webp"|"gif"} format Tile format
 * @param {Array<number>} zooms Array of specific zoom levels
 * @param {Array<number>} bounds Bounding box in format [lonMin, latMin, lonMax, latMax] in EPSG:4326
 * @param {number} concurrency Concurrency download
 * @param {number} maxTry Number of retry attempts on failure
 * @param {string|number} cleanUpBefore Date string in format "YYYY-MM-DDTHH:mm:ss" or number of days before which files should be deleted
 * @returns {Promise<void>}
 */
export async function cleanXYZTileDataFiles(
  outputFolder,
  format = "png",
  zooms = [
    0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20,
    21, 22,
  ],
  bounds = [-180, -85.051129, 180, 85.051129],
  concurrency = os.cpus().length,
  maxTry = 5,
  cleanUpBefore
) {
  let cleanUpTimestamp;
  let log = `Removing tile data files with:\n\tZoom levels [${zooms.join(
    ", "
  )}]\n\tBBox [${bounds.join(", ")}]`;

  if (typeof cleanUpBefore === "string") {
    cleanUpTimestamp = new Date(cleanUpBefore).getTime();

    log += `\n\tBefore ${cleanUpBefore}`;
  } else if (typeof cleanUpBefore === "number") {
    const now = new Date();

    cleanUpTimestamp = now.setDate(now.getDate() - cleanUpBefore);

    log += `\n\tOld than ${cleanUpBefore} days`;
  }

  printLog("info", log);

  // Remove files
  const tilesSummary = getTileBoundsFromBBox(bounds, zooms, "xyz");
  const limitConcurrencyDownload = pLimit(concurrency);
  const tilePromises = [];
  const hashs = {};

  for (const z in tilesSummary) {
    for (let x = tilesSummary[z].x[0]; x <= tilesSummary[z].x[1]; x++) {
      for (let y = tilesSummary[z].y[0]; y <= tilesSummary[z].y[1]; y++) {
        tilePromises.push(
          limitConcurrencyDownload(async () => {
            const tileName = `${z}/${x}/${y}`;
            const filePath = `${outputFolder}/${tileName}.${format}`;

            try {
              const stats = await fsPromise.stat(filePath);

              if (cleanUpTimestamp !== undefined) {
                if (
                  stats.ctimeMs === undefined ||
                  stats.ctimeMs < cleanUpTimestamp
                ) {
                  await removeXYZTileDataFile(
                    outputFolder,
                    tileName,
                    format,
                    maxTry,
                    300000, // 5 mins
                    hashs
                  );
                }
              }
            } catch (error) {
              await removeXYZTileDataFile(
                outputFolder,
                tileName,
                format,
                maxTry,
                300000, // 5 mins
                hashs
              );
            }
          })
        );
      }
    }
  }

  await Promise.all(tilePromises);

  // Update md5.json file
  await updateXYZMD5FileWithLock(
    outputFolder,
    hashs,
    300000 // 5 mins
  );

  // Remove parent folder if empty
  await removeEmptyFolders(outputFolder);
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
          '-.____'.___ \\_____/___.-'____.-'==========
                     '=---='
          Buddha bless, server immortal
        Starting seed and clean up data with ${opts.numProcesses} processes
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

  /* Run clean up task */
  if (opts.cleanUp) {
    try {
      const cleanUpDataSources = Object.keys(cleanUpData.datas);

      printLog(
        "info",
        `Starting clean up ${cleanUpDataSources.length} datas...`
      );

      for (const cleanUpDataSource of cleanUpDataSources) {
        try {
          await cleanXYZTileDataFiles(
            `${opts.dataDir}/caches/xyzs/${id}`,
            seedData.datas[id].format,
            cleanUpDataSource.zooms || seedData.datas[id].zooms,
            cleanUpDataSource.bounds || seedData.datas[id].bounds,
            seedData.datas[id].concurrency,
            seedData.datas[id].maxTry,
            cleanUpDataSource.cleanUpBefore?.time ||
              cleanUpDataSource.cleanUpBefore?.day ||
              seedData.datas[id].refreshBefore?.time ||
              seedData.datas[id].refreshBefore?.day
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
      const seedDataSources = Object.keys(seedData.datas);

      printLog("info", `Starting seed ${seedDataSources.length} datas...`);

      for (const seedDataSource of seedDataSources) {
        try {
          await seedXYZTileDataFiles(
            seedDataSource.name,
            seedDataSource.description,
            seedDataSource.url,
            `${opts.dataDir}/caches/xyzs/${id}`,
            seedDataSource.format,
            seedDataSource.bounds,
            seedDataSource.center,
            seedDataSource.zooms,
            seedDataSource.vector_layers,
            seedDataSource.tilestats,
            seedDataSource.concurrency,
            seedDataSource.maxTry,
            seedDataSource.timeout,
            seedDataSource.refreshBefore?.time ||
              seedDataSource.refreshBefore?.day ||
              seedDataSource.refreshBefore?.md5
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
