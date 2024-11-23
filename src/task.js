"use strict";

import { downloadStyleFile, removeStyleFile } from "./style.js";
import { getMBTilesTileMD5, getXYZTileMD5 } from "./md5.js";
import { readCleanUpFile } from "./cleanup.js";
import { readSeedFile } from "./seed.js";
import fsPromise from "node:fs/promises";
import { printLog } from "./logger.js";
import { Mutex } from "async-mutex";
import path from "node:path";
import {
  updateXYZMetadataFileWithLock,
  downloadXYZTileDataFile,
  removeXYZTileDataFile,
} from "./xyz.js";
import {
  getTileBoundsFromBBox,
  removeEmptyFolders,
  getDataFromURL,
  delay,
} from "./utils.js";
import os from "os";
import {
  updateMBTilesMetadataWithLock,
  removeMBTilesTileData,
  downloadMBTilesTile,
  openMBTilesDB,
} from "./mbtiles.js";

/**
 * Run clean up and seed tasks
 * @param {object} opts Options
 * @returns {Promise<void>}
 */
export async function runTasks(opts) {
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
  await cleanUpTask(dataDir, cleanUpData, seedData);

  /* Run seed task */
  await seedTask(dataDir, seedData);
}

/**
 * Run clean up task
 * @param {string} dataDir The data directory
 * @param {object} cleanUpData Clean up object
 * @param {object} seedData Seed object
 * @returns {Promise<void>}
 */
async function cleanUpTask(dataDir, cleanUpData, seedData) {
  try {
    printLog(
      "info",
      `Starting clean up ${Object.keys(cleanUpData.styles).length} styles...`
    );

    for (const id in cleanUpData.styles) {
      try {
        await cleanUpStyle(
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
        await cleanUpXYZTiles(
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
async function seedTask(dataDir, seedData) {
  try {
    printLog(
      "info",
      `Starting seed ${Object.keys(seedData.styles).length} styles...`
    );

    for (const id in seedData.styles) {
      try {
        await seedStyle(
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
        await seedXYZTiles(
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
 * Download all MBTiles tile data files in a specified bounding box and zoom levels
 * @param {string} sourcePath Folder path
 * @param {object} metadata Metadata object
 * @param {string} tileURL Tile URL to download
 * @param {Array<number>} bbox Bounding box in format [lonMin, latMin, lonMax, latMax] in EPSG:4326
 * @param {Array<number>} zooms Array of specific zoom levels
 * @param {number} concurrency Concurrency download
 * @param {number} maxTry Number of retry attempts on failure
 * @param {number} timeout Timeout in milliseconds
 * @param {boolean} storeMD5 Is store MD5 hashed?
 * @param {boolean} storeTransparent Is store transparent tile?
 * @param {string|number|boolean} refreshBefore Date string in format "YYYY-MM-DDTHH:mm:ss" or number of days before which files should be refreshed
 * @returns {Promise<void>}
 */
async function seedMBTilesTiles(
  sourcePath,
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
  let log = `Seeding ${totalTasks} tiles of cache mbtiles data id ${path.basename(
    sourcePath
  )} with:\n\tConcurrency: ${concurrency}\n\tMax tries: ${maxTry}\n\tTimeout: ${timeout}\n\tZoom levels: [${zooms.join(
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

  // Open MBTiles database
  const mbtilesSource = await openMBTilesDB(
    sourcePath,
    sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE,
    true
  );

  // Update metadata
  printLog("info", `Updating metadata to "${sourcePath}"...`);

  await updateMBTilesMetadataWithLock(
    mbtilesSource,
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
                `${sourcePath}/${tileName}.${metadata.format}`
              );

              if (refreshTimestamp === true) {
                const md5URL = tileURL.replaceAll(
                  "{z}/{x}/{y}",
                  `md5/${tileName}`
                );

                const response = await getDataFromURL(md5URL, timeout);

                let oldMD5;

                try {
                  oldMD5 = await getMBTilesTileMD5(mbtilesSource, z, x, y);
                } catch (error) {
                  if (error.message === "Tile MD5 does not exist") {
                    await downloadMBTilesTile(
                      url,
                      mbtilesSource,
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
                  await downloadMBTilesTile(
                    url,
                    mbtilesSource,
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
                await downloadMBTilesTile(
                  url,
                  mbtilesSource,
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
              await downloadMBTilesTile(
                url,
                mbtilesSource,
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
                sourcePath,
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
                `Failed to seed tile data "${tileName}": ${error}`
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
}

/**
 * Remove all MBTiles tile data files in a specified zoom levels
 * @param {string} sourcePath Folder to store downloaded tiles
 * @param {"jpeg"|"jpg"|"pbf"|"png"|"webp"|"gif"} format Tile format
 * @param {Array<number>} zooms Array of specific zoom levels
 * @param {Array<number>} bbox Bounding box in format [lonMin, latMin, lonMax, latMax] in EPSG:4326
 * @param {number} concurrency Concurrency download
 * @param {number} maxTry Number of retry attempts on failure
 * @param {boolean} storeMD5 Is store MD5 hashed?
 * @param {string|number} cleanUpBefore Date string in format "YYYY-MM-DDTHH:mm:ss" or number of days before which files should be deleted
 * @returns {Promise<void>}
 */
async function cleanUpMBTilesTiles(
  sourcePath,
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
  let log = `Cleaning up ${totalTasks} tiles of cache mbtiles data id ${path.basename(
    sourcePath
  )} with:\n\tConcurrency: ${concurrency}\n\tMax tries: ${maxTry}\n\tZoom levels: [${zooms.join(
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

  // Open MBTiles database
  const mbtilesSource = await openMBTilesDB(
    sourcePath,
    sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE,
    true
  );

  // Remove tiles
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
                `${sourcePath}/${tileName}.${format}`
              );

              if (
                stats.ctimeMs === undefined ||
                stats.ctimeMs < cleanUpTimestamp
              ) {
                await removeMBTilesTileData(
                  mbtilesSource,
                  z,
                  x,
                  y,
                  maxTry,
                  300000, // 5 mins
                  storeMD5
                );
              }
            } else {
              await removeMBTilesTileData(
                mbtilesSource,
                z,
                x,
                y,
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
}

/**
 * Seed cache XYZ tiles
 * @param {string} sourcePath Folder path
 * @param {object} metadata Metadata object
 * @param {string} tileURL Tile URL
 * @param {Array<number>} bbox Bounding box in format [lonMin, latMin, lonMax, latMax] in EPSG:4326
 * @param {Array<number>} zooms Array of specific zoom levels
 * @param {number} concurrency Concurrency to download
 * @param {number} maxTry Number of retry attempts on failure
 * @param {number} timeout Timeout in milliseconds
 * @param {boolean} storeMD5 Is store MD5 hashed?
 * @param {boolean} storeTransparent Is store transparent tile?
 * @param {string|number|boolean} refreshBefore Date string in format "YYYY-MM-DDTHH:mm:ss" or number of days before which files should be refreshed
 * @returns {Promise<void>}
 */
async function seedXYZTiles(
  sourcePath,
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
  let log = `Seeding ${totalTasks} tiles of cache xyz data id ${path.basename(
    sourcePath
  )} with:\n\tConcurrency: ${concurrency}\n\tMax tries: ${maxTry}\n\tTimeout: ${timeout}\n\tZoom levels: [${zooms.join(
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
  const metadataFilePath = `${sourcePath}/metadata.json`;

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
                `${sourcePath}/${tileName}.${metadata.format}`
              );

              if (refreshTimestamp === true) {
                const md5URL = tileURL.replaceAll(
                  "{z}/{x}/{y}",
                  `md5/${tileName}`
                );

                const response = await getDataFromURL(md5URL, timeout);

                let oldMD5;

                try {
                  oldMD5 = await getXYZTileMD5(sourcePath, z, x, y);
                } catch (error) {
                  if (error.message === "Tile MD5 does not exist") {
                    await downloadXYZTileDataFile(
                      url,
                      sourcePath,
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
                    sourcePath,
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
                  sourcePath,
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
                sourcePath,
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
                sourcePath,
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
    sourcePath,
    /^.*\.(sqlite|json|gif|png|jpg|jpeg|webp|pbf)$/
  );
}

/**
 * Clean up cache XYZ tiles
 * @param {string} sourcePath Folder path
 * @param {"jpeg"|"jpg"|"pbf"|"png"|"webp"|"gif"} format Tile format
 * @param {Array<number>} zooms Array of specific zoom levels
 * @param {Array<number>} bbox Bounding box in format [lonMin, latMin, lonMax, latMax] in EPSG:4326
 * @param {number} concurrency Concurrency to clean up
 * @param {number} maxTry Number of retry attempts on failure
 * @param {boolean} storeMD5 Is store MD5 hashed?
 * @param {string|number} cleanUpBefore Date string in format "YYYY-MM-DDTHH:mm:ss" or number of days before which files should be deleted
 * @returns {Promise<void>}
 */
async function cleanUpXYZTiles(
  sourcePath,
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
  let log = `Cleaning up ${totalTasks} tiles of cache xyz data id ${path.basename(
    sourcePath
  )} with:\n\tConcurrency: ${concurrency}\n\tMax tries: ${maxTry}\n\tZoom levels: [${zooms.join(
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
                `${sourcePath}/${tileName}.${format}`
              );

              if (
                stats.ctimeMs === undefined ||
                stats.ctimeMs < cleanUpTimestamp
              ) {
                await removeXYZTileDataFile(
                  sourcePath,
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
                sourcePath,
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
                `Failed to clean up tile "${tileName}": ${error}`
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
    sourcePath,
    /^.*\.(sqlite|json|gif|png|jpg|jpeg|webp|pbf)$/
  );
}

/**
 * Seed cache style
 * @param {string} sourcePath Folder path
 * @param {string} styleURL Style URL
 * @param {number} maxTry Number of retry attempts on failure
 * @param {number} timeout Timeout in milliseconds
 * @param {string|number} refreshBefore Date string in format "YYYY-MM-DDTHH:mm:ss" or number of days before which file should be refreshed
 * @returns {Promise<void>}
 */
async function seedStyle(
  sourcePath,
  styleURL,
  maxTry = 5,
  timeout = 60000,
  refreshBefore
) {
  let refreshTimestamp;
  let log = `Seeding cache style id ${path.basename(
    sourcePath
  )} with:\n\tMax tries: ${maxTry}\n\tTimeout: ${timeout}`;

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
  const filePath = `${sourcePath}/style.json`;

  try {
    if (refreshTimestamp !== undefined) {
      const stats = await fsPromise.stat(filePath);

      // Check timestamp
      if (stats.ctimeMs === undefined || stats.ctimeMs < refreshTimestamp) {
        await downloadStyleFile(styleURL, filePath, maxTry, timeout);
      }
    } else {
      await downloadStyleFile(styleURL, filePath, maxTry, timeout);
    }
  } catch (error) {
    if (error.code === "ENOENT") {
      await downloadStyleFile(styleURL, filePath, maxTry, timeout);
    } else {
      printLog(
        "error",
        `Failed to seed cache style id ${path.basename(sourcePath)}: ${error}`
      );
    }
  }

  // Remove parent folders if empty
  await removeEmptyFolders(sourcePath, /^.*\.json$/);
}

/**
 * Clean up cache style
 * @param {string} sourcePath Folder path
 * @param {string|number} cleanUpBefore Date string in format "YYYY-MM-DDTHH:mm:ss" or number of days before which files should be deleted
 * @returns {Promise<void>}
 */
async function cleanUpStyle(sourcePath, cleanUpBefore) {
  let cleanUpTimestamp;
  let log = `Cleaning up cache style id ${path.basename(
    sourcePath
  )} with:\n\tMax tries: ${maxTry}`;

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
  const filePath = `${sourcePath}/style.json`;

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
        `Failed to clean up cache style id ${path.basename(
          sourcePath
        )}: ${error}`
      );
    }
  }

  // Remove parent folders if empty
  await removeEmptyFolders(sourcePath, /^.*\.json$/);
}
