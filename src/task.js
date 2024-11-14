"use strict";

import { readCleanUpFile, readSeedFile } from "./config.js";
import fsPromise from "node:fs/promises";
import { printLog } from "./logger.js";
import path from "node:path";
import pLimit from "p-limit";
import {
  updateXYZMetadataFileWithLock,
  updateXYZMD5FileWithLock,
  downloadXYZTileDataFile,
  removeXYZTileDataFile,
} from "./xyz.js";
import {
  getTileBoundsFromBBox,
  removeEmptyFolders,
  getDataBuffer,
  restartServer,
} from "./utils.js";
import os from "os";

/**
 * Update task-info.json file
 * @param {Object<string,string>} taskInfoAdds Task info object
 * @returns {Promise<void>}
 */
export async function updateTaskInfoFile(taskInfoAdds) {
  const filePath = "task-info.json";
  const tempFilePath = `${filePath}.tmp`;

  try {
    const taskInfo = JSON.parse(await fsPromise.readFile(filePath, "utf8"));

    await fsPromise.writeFile(
      tempFilePath,
      JSON.stringify(
        {
          ...taskInfo,
          ...taskInfoAdds,
        },
        null,
        2
      ),
      "utf8"
    );

    await fsPromise.rename(tempFilePath, filePath);
  } catch (error) {
    if (error.code === "ENOENT") {
      await fsPromise.mkdir(path.dirname(filePath), {
        recursive: true,
      });

      await fsPromise.writeFile(
        filePath,
        JSON.stringify(taskInfoAdds, null, 2),
        "utf8"
      );
    } else {
      await fsPromise.rm(tempFilePath, {
        force: true,
      });

      throw error;
    }
  }
}

/**
 * Update task-info.json file with lock
 * @param {Object<string,string>} taskInfoAdds Task info object
 * @param {number} timeout Timeout in milliseconds
 * @returns {Promise<void>}
 */
export async function updateTaskInfoFileWithLock(taskInfoAdds, timeout) {
  const filePath = "task-info.json";
  const startTime = Date.now();
  const lockFilePath = `${filePath}.lock`;
  let lockFileHandle;

  while (Date.now() - startTime <= timeout) {
    try {
      lockFileHandle = await fsPromise.open(lockFilePath, "wx");

      await updateTaskInfoFile(taskInfoAdds);

      await lockFileHandle.close();

      await fsPromise.rm(lockFilePath, {
        force: true,
      });

      return;
    } catch (error) {
      if (error.code === "ENOENT") {
        await fsPromise.mkdir(path.dirname(filePath), {
          recursive: true,
        });

        await updateTaskInfoFileWithLock(taskInfoAdds, timeout);

        return;
      } else if (error.code === "EEXIST") {
        await delay(50);
      } else {
        if (lockFileHandle !== undefined) {
          await lockFileHandle.close();

          await fsPromise.rm(lockFilePath, {
            force: true,
          });
        }

        throw error;
      }
    }
  }

  throw new Error(`Timeout to access ${lockFilePath} file`);
}

/**
 * Run task
 * @param {object} opts Options
 * @returns {Promise<void>}
 */
export async function runTask(opts) {
  printLog("info", "Starting seed and clean up task...");

  /* Read cleanup.json and seed.json files */
  printLog(
    "info",
    `Loading seed.json and cleanup.json files at "${opts.dataDir}"...`
  );

  const [cleanUpData, seedData] = await Promise.all([
    readCleanUpFile(opts.dataDir, true),
    readSeedFile(opts.dataDir, true),
  ]);

  /* Run clean up task */
  await runCleanUpTask(opts.dataDir, cleanUpData, seedData);

  /* Run seed task */
  await runSeedTask(opts.dataDir, seedData);

  /* Restart server */
  if (opts.restartServerAfterTask === true) {
    printLog("info", "Completed seed and clean up task. Restarting server...");

    await restartServer();
  }
}

/**
 * Download all xyz tile data files in a specified bounding box and zoom levels
 * @param {string} outputFolder Folder to store downloaded tiles
 * @param {object} name Metadata object
 * @param {string} tileURL Tile URL to download
 * @param {Array<number>} bbox Bounding box in format [lonMin, latMin, lonMax, latMax] in EPSG:4326
 * @param {Array<number>} zooms Array of specific zoom levels
 * @param {number} concurrency Concurrency download
 * @param {number} maxTry Number of retry attempts on failure
 * @param {number} timeout Timeout in milliseconds
 * @param {string|number|boolean} refreshBefore Date string in format "YYYY-MM-DDTHH:mm:ss" or number of days before which files should be refreshed
 * @returns {Promise<void>}
 */
async function seedXYZTileDataFiles(
  outputFolder,
  metadata,
  tileURL,
  bbox = [-180, -85.051129, 180, 85.051129],
  zooms = [
    0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20,
    21, 22,
  ],
  concurrency = os.cpus().length,
  maxTry = 5,
  timeout = 60000,
  refreshBefore
) {
  let refreshTimestamp;
  let log = `Downloading tile data files with:\n\tConcurrency: ${concurrency}\n\tMax tries: ${maxTry}\n\tTimeout: ${timeout}\n\tZoom levels: [${zooms.join(
    ", "
  )}]\n\tBBox: [${bbox.join(", ")}]`;

  if (typeof refreshBefore === "string") {
    refreshTimestamp = new Date(refreshBefore).getTime();

    log += `\n\tBefore: ${refreshBefore}`;
  } else if (typeof refreshBefore === "number") {
    const now = new Date();

    refreshTimestamp = now.setDate(now.getDate() - refreshBefore);

    log += `\n\tOld than: ${refreshBefore} days`;
  } else if (typeof refreshBefore === "boolean") {
    refreshTimestamp = true;

    log += `\n\tBefore: check MD5`;
  }

  printLog("info", log);

  // Download file
  const tilesSummary = getTileBoundsFromBBox(bbox, zooms, "xyz");
  const limitConcurrencyDownload = pLimit(concurrency);
  const tilePromises = [];
  const hashs = {};

  for (const z in tilesSummary) {
    for (let x = tilesSummary[z].x[0]; x <= tilesSummary[z].x[1]; x++) {
      for (let y = tilesSummary[z].y[0]; y <= tilesSummary[z].y[1]; y++) {
        tilePromises.push(
          limitConcurrencyDownload(async () => {
            const tileName = `${z}/${x}/${y}`;
            const filePath = `${outputFolder}/${tileName}.${metadata.format}`;
            const url = tileURL.replaceAll("{z}/{x}/{y}", tileName);

            try {
              if (refreshTimestamp !== undefined) {
                const stats = await fsPromise.stat(filePath);

                if (refreshTimestamp === true) {
                  // Check md5
                  const md5URL = tileURL.replaceAll(
                    "{z}/{x}/{y}",
                    `md5/${tileName}`
                  );

                  const response = await getDataBuffer(md5URL, timeout);

                  if (response.headers["Etag"] !== hashs[tileName]) {
                    await downloadXYZTileDataFile(
                      url,
                      outputFolder,
                      tileName,
                      metadata.format,
                      maxTry,
                      timeout,
                      hashs
                    );
                  }
                } else if (
                  stats.ctimeMs === undefined ||
                  stats.ctimeMs < refreshTimestamp
                ) {
                  // Check timestamp
                  await downloadXYZTileDataFile(
                    url,
                    outputFolder,
                    tileName,
                    metadata.format,
                    maxTry,
                    timeout,
                    hashs
                  );
                }
              } else {
                await downloadXYZTileDataFile(
                  url,
                  outputFolder,
                  tileName,
                  metadata.format,
                  maxTry,
                  timeout,
                  hashs
                );
              }
            } catch (error) {
              if (error.code === "ENOENT") {
                await downloadXYZTileDataFile(
                  url,
                  outputFolder,
                  tileName,
                  metadata.format,
                  maxTry,
                  timeout,
                  hashs
                );
              } else {
                printLog(
                  "error",
                  `Failed to seed tile data file "${tileName}": ${error}`
                );
              }
            }
          })
        );
      }
    }
  }

  await Promise.all(tilePromises);

  // Update metadata.json file
  const metadataFilePath = `${outputFolder}/metadata.json`;

  await updateXYZMetadataFileWithLock(
    metadataFilePath,
    metadata,
    300000 // 5 mins
  );

  // Update md5.json file
  const md5FilePath = `${outputFolder}/md5.json`;

  await updateXYZMD5FileWithLock(
    md5FilePath,
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
 * @param {Array<number>} bbox Bounding box in format [lonMin, latMin, lonMax, latMax] in EPSG:4326
 * @param {number} concurrency Concurrency download
 * @param {number} maxTry Number of retry attempts on failure
 * @param {string|number} cleanUpBefore Date string in format "YYYY-MM-DDTHH:mm:ss" or number of days before which files should be deleted
 * @returns {Promise<void>}
 */
async function cleanXYZTileDataFiles(
  outputFolder,
  format,
  zooms = [
    0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20,
    21, 22,
  ],
  bbox = [-180, -85.051129, 180, 85.051129],
  concurrency = os.cpus().length,
  maxTry = 5,
  cleanUpBefore
) {
  let cleanUpTimestamp;
  let log = `Removing tile data files with:\n\tConcurrency: ${concurrency}\n\tMax tries: ${maxTry}\n\tZoom levels: [${zooms.join(
    ", "
  )}]\n\tBBox: [${bbox.join(", ")}]`;

  if (typeof cleanUpBefore === "string") {
    cleanUpTimestamp = new Date(cleanUpBefore).getTime();

    log += `\n\tBefore: ${cleanUpBefore}`;
  } else if (typeof cleanUpBefore === "number") {
    const now = new Date();

    cleanUpTimestamp = now.setDate(now.getDate() - cleanUpBefore);

    log += `\n\tOld than: ${cleanUpBefore} days`;
  }

  printLog("info", log);

  // Remove files
  const tilesSummary = getTileBoundsFromBBox(bbox, zooms, "xyz");
  const limitConcurrencyRemove = pLimit(concurrency);
  const tilePromises = [];
  const hashs = {};

  for (const z in tilesSummary) {
    for (let x = tilesSummary[z].x[0]; x <= tilesSummary[z].x[1]; x++) {
      for (let y = tilesSummary[z].y[0]; y <= tilesSummary[z].y[1]; y++) {
        tilePromises.push(
          limitConcurrencyRemove(async () => {
            const tileName = `${z}/${x}/${y}`;
            const filePath = `${outputFolder}/${tileName}.${format}`;

            try {
              if (cleanUpTimestamp !== undefined) {
                const stats = await fsPromise.stat(filePath);

                // Check timestamp
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
              } else {
                await removeXYZTileDataFile(
                  outputFolder,
                  tileName,
                  format,
                  maxTry,
                  300000, // 5 mins
                  hashs
                );
              }
            } catch (error) {
              if (error.code === "ENOENT") {
                return;
              } else {
                printLog(
                  "error",
                  `Failed to clean up tile data file "${tileName}": ${error}`
                );
              }
            }
          })
        );
      }
    }
  }

  await Promise.all(tilePromises);

  // Update md5.json file
  const md5FilePath = `${outputFolder}/md5.json`;

  await updateXYZMD5FileWithLock(
    md5FilePath,
    hashs,
    300000 // 5 mins
  );

  // Remove parent folder if empty
  await removeEmptyFolders(outputFolder);
}

/**
 * Run clean up task
 * @param {string} dataDir The data directory
 * @param {object} cleanUpData Clean up object
 * @param {object} seedData Seed object
 * @returns {Promise<void>}
 */
async function runCleanUpTask(dataDir, cleanUpData, seedData) {
  try {
    printLog(
      "info",
      `Starting clean up ${Object.keys(cleanUpData.datas).length} datas...`
    );

    for (const id in cleanUpData.datas) {
      try {
        await cleanXYZTileDataFiles(
          `${dataDir}/caches/xyzs/${id}`,
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

    printLog("info", "Completed clean up data!");
  } catch (error) {
    printLog("error", `Failed to clean up data: ${error}. Exited!`);
  }
}

/**
 * Run seed task
 * @param {string} dataDir The data directory
 * @param {object} seedData Seed object
 * @returns {Promise<void>}
 */
async function runSeedTask(dataDir, seedData) {
  try {
    printLog(
      "info",
      `Starting seed ${Object.keys(seedData.datas).length} datas...`
    );

    for (const id in seedData.datas) {
      try {
        await seedXYZTileDataFiles(
          `${dataDir}/caches/xyzs/${id}`,
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

    printLog("info", "Completed seed data!");
  } catch (error) {
    printLog("error", `Failed to seed data: ${error}. Exited!`);
  }
}
