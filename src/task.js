"use strict";

import { downloadStyleFile, removeStyleFile } from "./style.js";
import { readCleanUpFile } from "./cleanup.js";
import { readSeedFile } from "./seed.js";
import { getXYZTileMD5 } from "./md5.js";
import fsPromise from "node:fs/promises";
import { printLog } from "./logger.js";
import { Mutex } from "async-mutex";
import {
  updateXYZMetadataFileWithLock,
  downloadXYZTileDataFile,
  removeXYZTileDataFile,
} from "./xyz.js";
import {
  getTileBoundsFromBBox,
  removeEmptyFolders,
  getDataBuffer,
  delay,
} from "./utils.js";
import os from "os";

/**
 * Run task
 * @param {object} opts Options
 * @returns {Promise<void>}
 */
export async function runTask(opts) {
  const dataDir = process.env.DATA_DIR;

  /* Read cleanup.json and seed.json files */
  printLog(
    "info",
    `Loading "seed.json" and "cleanup.json" files at "${dataDir}"...`
  );

  const [cleanUpData, seedData] = await Promise.all([
    readCleanUpFile(dataDir, true),
    readSeedFile(dataDir, true),
  ]);

  /* Run clean up task */
  await runCleanUpTask(dataDir, cleanUpData, seedData);

  /* Run seed task */
  await runSeedTask(dataDir, seedData);
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
 * @param {boolean} storeMD5 Is store MD5 hashed?
 * @param {boolean} storeTransparent Is store transparent?
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
  storeMD5 = false,
  storeTransparent = false,
  refreshBefore
) {
  const tilesSummary = getTileBoundsFromBBox(bbox, zooms, "xyz");
  let totalTasks = Object.values(tilesSummary).reduce(
    (total, tile) =>
      total + (tile.x[1] - tile.x[0] + 1) * (tile.y[1] - tile.y[0] + 1),
    0
  );
  let refreshTimestamp;
  let log = `Seeding ${totalTasks} tile data files with:\n\tConcurrency: ${concurrency}\n\tMax tries: ${maxTry}\n\tTimeout: ${timeout}\n\tZoom levels: [${zooms.join(
    ", "
  )}]\n\tBBox: [${bbox.join(", ")}]`;

  if (typeof refreshBefore === "string") {
    refreshTimestamp = new Date(refreshBefore).getTime();

    log += `\n\tRefresh before: ${refreshBefore}`;
  } else if (typeof refreshBefore === "number") {
    const now = new Date();

    refreshTimestamp = now.setDate(now.getDate() - refreshBefore);

    log += `\n\tOld than: ${refreshBefore} days`;
  } else if (typeof refreshBefore === "boolean") {
    refreshTimestamp = true;

    log += `\n\tRefresh before: check MD5`;
  }

  printLog("info", log);

  // Update metadata.json file
  const metadataFilePath = `${outputFolder}/metadata.json`;

  printLog("info", `Updating metadata to "${metadataFilePath}"...`);

  await updateXYZMetadataFileWithLock(
    metadataFilePath,
    metadata,
    300000 // 5 mins
  );

  // Download files
  let activeTasks = 0;
  const mutex = new Mutex();

  async function updateActiveTasks(action) {
    return await mutex.runExclusive(async () => {
      return action();
    });
  }

  for (const z in tilesSummary) {
    for (let x = tilesSummary[z].x[0]; x <= tilesSummary[z].x[1]; x++) {
      for (let y = tilesSummary[z].y[0]; y <= tilesSummary[z].y[1]; y++) {
        /* Wait slot for a task */
        while (activeTasks >= concurrency) {
          await delay(50);
        }

        await mutex.runExclusive(() => {
          activeTasks++;

          totalTasks--;
        });

        /* Run a task */
        (async () => {
          const tileName = `${z}/${x}/${y}`;
          const url = tileURL.replaceAll("{z}/{x}/{y}", tileName);

          try {
            if (refreshTimestamp !== undefined) {
              const stats = await fsPromise.stat(
                `${outputFolder}/${tileName}.${metadata.format}`
              );

              if (refreshTimestamp === true) {
                const md5URL = tileURL.replaceAll(
                  "{z}/{x}/{y}",
                  `md5/${tileName}`
                );

                const response = await getDataBuffer(md5URL, timeout);
                let oldMD5;

                try {
                  oldMD5 = getXYZTileMD5(`${outputFolder}/md5.sqlite`, z, x, y);
                } catch (error) {
                  if (error.message === "Tile MD5 does not exist") {
                    await downloadXYZTileDataFile(
                      url,
                      outputFolder,
                      z,
                      x,
                      y,
                      metadata.format,
                      maxTry,
                      timeout,
                      storeMD5,
                      storeTransparent
                    );
                  }
                }

                if (response.headers["Etag"] !== oldMD5) {
                  await downloadXYZTileDataFile(
                    url,
                    outputFolder,
                    z,
                    x,
                    y,
                    metadata.format,
                    maxTry,
                    timeout,
                    storeMD5,
                    storeTransparent
                  );
                }
              } else if (
                stats.ctimeMs === undefined ||
                stats.ctimeMs < refreshTimestamp
              ) {
                await downloadXYZTileDataFile(
                  url,
                  outputFolder,
                  z,
                  x,
                  y,
                  metadata.format,
                  maxTry,
                  timeout,
                  storeMD5,
                  storeTransparent
                );
              }
            } else {
              await downloadXYZTileDataFile(
                url,
                outputFolder,
                z,
                x,
                y,
                metadata.format,
                maxTry,
                timeout,
                storeMD5,
                storeTransparent
              );
            }
          } catch (error) {
            if (error.code === "ENOENT") {
              await downloadXYZTileDataFile(
                url,
                outputFolder,
                z,
                x,
                y,
                metadata.format,
                maxTry,
                timeout,
                storeMD5,
                storeTransparent
              );
            } else {
              printLog(
                "error",
                `Failed to seed tile data file "${tileName}": ${error}`
              );
            }
          } finally {
            await updateActiveTasks(() => {
              activeTasks--;
            });
          }
        })();
      }
    }
  }

  /* Wait all tasks done */
  while (activeTasks > 0) {
    await delay(50);
  }

  // Remove parent folders if empty
  await removeEmptyFolders(
    outputFolder,
    /^.*\.(sqlite|json|gif|png|jpg|jpeg|webp|pbf)$/
  );
}

/**
 * Remove all xyz tile data files in a specified zoom levels
 * @param {string} outputFolder Folder to store downloaded tiles
 * @param {"jpeg"|"jpg"|"pbf"|"png"|"webp"|"gif"} format Tile format
 * @param {Array<number>} zooms Array of specific zoom levels
 * @param {Array<number>} bbox Bounding box in format [lonMin, latMin, lonMax, latMax] in EPSG:4326
 * @param {number} concurrency Concurrency download
 * @param {number} maxTry Number of retry attempts on failure
 * @param {boolean} storeMD5 Is store MD5 hashed?
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
  storeMD5 = false,
  cleanUpBefore
) {
  const tilesSummary = getTileBoundsFromBBox(bbox, zooms, "xyz");
  let totalTasks = Object.values(tilesSummary).reduce(
    (total, tile) =>
      total + (tile.x[1] - tile.x[0] + 1) * (tile.y[1] - tile.y[0] + 1),
    0
  );
  let cleanUpTimestamp;
  let log = `Cleaning up ${totalTasks} tile data files with:\n\tConcurrency: ${concurrency}\n\tMax tries: ${maxTry}\n\tZoom levels: [${zooms.join(
    ", "
  )}]\n\tBBox: [${bbox.join(", ")}]`;

  if (typeof cleanUpBefore === "string") {
    cleanUpTimestamp = new Date(cleanUpBefore).getTime();

    log += `\n\tClean up before: ${cleanUpBefore}`;
  } else if (typeof cleanUpBefore === "number") {
    const now = new Date();

    cleanUpTimestamp = now.setDate(now.getDate() - cleanUpBefore);

    log += `\n\tOld than: ${cleanUpBefore} days`;
  }

  printLog("info", log);

  // Remove files
  let activeTasks = 0;
  const mutex = new Mutex();

  async function updateActiveTasks(action) {
    return await mutex.runExclusive(async () => {
      return action();
    });
  }

  for (const z in tilesSummary) {
    for (let x = tilesSummary[z].x[0]; x <= tilesSummary[z].x[1]; x++) {
      for (let y = tilesSummary[z].y[0]; y <= tilesSummary[z].y[1]; y++) {
        /* Wait slot for a task */
        while (activeTasks >= concurrency) {
          await delay(50);
        }

        await mutex.runExclusive(() => {
          activeTasks++;

          totalTasks--;
        });

        /* Run a task */
        (async () => {
          const tileName = `${z}/${x}/${y}`;

          try {
            if (cleanUpTimestamp !== undefined) {
              const stats = await fsPromise.stat(
                `${outputFolder}/${tileName}.${format}`
              );

              if (
                stats.ctimeMs === undefined ||
                stats.ctimeMs < cleanUpTimestamp
              ) {
                await removeXYZTileDataFile(
                  outputFolder,
                  z,
                  x,
                  y,
                  format,
                  maxTry,
                  300000, // 5 mins
                  storeMD5
                );
              }
            } else {
              await removeXYZTileDataFile(
                outputFolder,
                z,
                x,
                y,
                format,
                maxTry,
                300000, // 5 mins
                storeMD5
              );
            }
          } catch (error) {
            if (error.code !== "ENOENT") {
              printLog(
                "error",
                `Failed to clean up tile data file "${tileName}": ${error}`
              );
            }
          } finally {
            await updateActiveTasks(() => {
              activeTasks--;
            });
          }
        })();
      }
    }
  }

  /* Wait all tasks done */
  while (activeTasks > 0) {
    await delay(50);
  }

  // Remove parent folders if empty
  await removeEmptyFolders(
    outputFolder,
    /^.*\.(sqlite|json|gif|png|jpg|jpeg|webp|pbf)$/
  );
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
      `Starting clean up ${Object.keys(cleanUpData.styles).length} styles...`
    );

    for (const id in cleanUpData.styles) {
      try {
        await cleanStyleFile(
          `${dataDir}/caches/styles/${id}`,
          cleanUpData.styles[id].cleanUpBefore?.time ||
            cleanUpData.styles[id].cleanUpBefore?.day
        );
      } catch (error) {
        printLog(
          "error",
          `Failed to clean up style id "${id}": ${error}. Skipping...`
        );
      }
    }

    printLog("info", "Completed clean up style!");
  } catch (error) {
    printLog("error", `Failed to clean up style: ${error}. Exited!`);
  }

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
          seedData.datas[id].storeMD5,
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
      `Starting seed ${Object.keys(seedData.styles).length} styles...`
    );

    for (const id in seedData.styles) {
      try {
        await seedStyleFile(
          `${dataDir}/caches/styles/${id}`,
          seedData.styles[id].url,
          seedData.styles[id].maxTry,
          seedData.styles[id].timeout,
          seedData.styles[id].refreshBefore?.time ||
            seedData.styles[id].refreshBefore?.day
        );
      } catch (error) {
        printLog(
          "error",
          `Failed to seed style id "${id}": ${error}. Skipping...`
        );
      }
    }

    printLog("info", "Completed seed style!");
  } catch (error) {
    printLog("error", `Failed to seed style: ${error}. Exited!`);
  }

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
          seedData.datas[id].storeMD5,
          seedData.datas[id].storeTransparent,
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

/**
 * Download style.json file
 * @param {string} outputFolder Folder to store downloaded style
 * @param {string} styleURL Style URL to download
 * @param {number} maxTry Number of retry attempts on failure
 * @param {number} timeout Timeout in milliseconds
 * @param {string|number} refreshBefore Date string in format "YYYY-MM-DDTHH:mm:ss" or number of days before which file should be refreshed
 * @returns {Promise<void>}
 */
async function seedStyleFile(
  outputFolder,
  styleURL,
  maxTry = 5,
  timeout = 60000,
  refreshBefore
) {
  let refreshTimestamp;
  let log = `Seeding style file with:\n\tMax tries: ${maxTry}\n\tTimeout: ${timeout}`;

  if (typeof refreshBefore === "string") {
    refreshTimestamp = new Date(refreshBefore).getTime();

    log += `\n\tRefresh before: ${refreshBefore}`;
  } else if (typeof refreshBefore === "number") {
    const now = new Date();

    refreshTimestamp = now.setDate(now.getDate() - refreshBefore);

    log += `\n\tOld than: ${refreshBefore} days`;
  }

  printLog("info", log);

  // Download file
  const filePath = `${outputFolder}/style.json`;

  try {
    if (refreshTimestamp !== undefined) {
      const stats = await fsPromise.stat(filePath);

      if (stats.ctimeMs === undefined || stats.ctimeMs < refreshTimestamp) {
        // Check timestamp
        await downloadStyleFile(styleURL, filePath, maxTry, timeout);
      }
    } else {
      await downloadStyleFile(styleURL, filePath, maxTry, timeout);
    }
  } catch (error) {
    if (error.code === "ENOENT") {
      await downloadStyleFile(styleURL, filePath, maxTry, timeout);
    } else {
      printLog("error", `Failed to seed style file "${filePath}": ${error}`);
    }
  }

  // Remove parent folders if empty
  await removeEmptyFolders(outputFolder, /^.*\.json$/);
}

/**
 * Remove style.json file
 * @param {string} outputFolder Folder to store downloaded style
 * @param {string|number} cleanUpBefore Date string in format "YYYY-MM-DDTHH:mm:ss" or number of days before which files should be deleted
 * @returns {Promise<void>}
 */
async function cleanStyleFile(outputFolder, cleanUpBefore) {
  let cleanUpTimestamp;
  let log = `Cleaning up style file with:\n\tMax tries: ${maxTry}`;

  if (typeof cleanUpBefore === "string") {
    cleanUpTimestamp = new Date(cleanUpBefore).getTime();

    log += `\n\tClean up before: ${cleanUpBefore}`;
  } else if (typeof cleanUpBefore === "number") {
    const now = new Date();

    cleanUpTimestamp = now.setDate(now.getDate() - cleanUpBefore);

    log += `\n\tOld than: ${cleanUpBefore} days`;
  }

  printLog("info", log);

  // Remove file
  const filePath = `${outputFolder}/style.json`;

  try {
    if (cleanUpTimestamp !== undefined) {
      const stats = await fsPromise.stat(filePath);

      // Check timestamp
      if (stats.ctimeMs === undefined || stats.ctimeMs < cleanUpTimestamp) {
        await removeStyleFile(
          filePath,
          maxTry,
          300000 // 5 mins
        );
      }
    } else {
      await removeStyleFile(
        filePath,
        maxTry,
        300000 // 5 mins
      );
    }
  } catch (error) {
    if (error.code === "ENOENT") {
      return;
    } else {
      printLog(
        "error",
        `Failed to clean up style file "${filePath}": ${error}`
      );
    }
  }

  // Remove parent folders if empty
  await removeEmptyFolders(outputFolder, /^.*\.json$/);
}
