"use strict";

import { closeXYZMD5DB, openXYZMD5DB, removeXYZTileDataFile } from "./xyz.js";
import { removeMBTilesTileData, openMBTilesDB } from "./mbtiles.js";
import { getStyleCreated, removeStyleFile } from "./style.js";
import fsPromise from "node:fs/promises";
import { printLog } from "./logger.js";
import { Mutex } from "async-mutex";
import sqlite3 from "sqlite3";
import path from "node:path";
import os from "os";
import {
  getTileBoundsFromBBox,
  removeEmptyFolders,
  validateJSON,
  delay,
} from "./utils.js";

/**
 * Read cleanup.json file
 * @param {string} dataDir The data directory
 * @param {boolean} isValidate Is validate file?
 * @returns {Promise<object>}
 */
export async function readCleanUpFile(dataDir, isValidate) {
  /* Read cleanup.json file */
  const data = await fsPromise.readFile(`${dataDir}/cleanup.json`, "utf8");

  const cleanUp = JSON.parse(data);

  /* Validate cleanup.json file */
  if (isValidate === true) {
    await validateJSON(
      {
        type: "object",
        properties: {
          styles: {
            type: "object",
            additionalProperties: {
              type: "object",
              properties: {
                cleanUpBefore: {
                  type: "object",
                  properties: {
                    time: {
                      type: "string",
                    },
                    day: {
                      type: "integer",
                      minimum: 0,
                    },
                  },
                  anyOf: [{ required: ["time"] }, { required: ["day"] }],
                  additionalProperties: true,
                },
              },
              additionalProperties: true,
            },
          },
          datas: {
            type: "object",
            additionalProperties: {
              type: "object",
              properties: {
                bbox: {
                  type: "array",
                  items: {
                    type: "number",
                    minimum: -180,
                    maximum: 180,
                  },
                  minItems: 4,
                  maxItems: 4,
                },
                zooms: {
                  type: "array",
                  items: {
                    type: "integer",
                    minimum: 0,
                    maximum: 22,
                  },
                  minItems: 0,
                  maxItems: 23,
                },
                cleanUpBefore: {
                  type: "object",
                  properties: {
                    time: {
                      type: "string",
                      minLength: 1,
                    },
                    day: {
                      type: "integer",
                      minimum: 0,
                    },
                  },
                  anyOf: [{ required: ["time"] }, { required: ["day"] }],
                  additionalProperties: true,
                },
              },
              additionalProperties: true,
            },
          },
          sprites: {
            type: "object",
            additionalProperties: {
              type: "object",
              properties: {
                cleanUpBefore: {
                  type: "object",
                  properties: {
                    time: {
                      type: "string",
                      minLength: 1,
                    },
                    day: {
                      type: "integer",
                      minimum: 0,
                    },
                  },
                  anyOf: [{ required: ["time"] }, { required: ["day"] }],
                  additionalProperties: true,
                },
              },
              additionalProperties: true,
            },
          },
          fonts: {
            type: "object",
            additionalProperties: {
              type: "object",
              properties: {
                cleanUpBefore: {
                  type: "object",
                  properties: {
                    time: {
                      type: "string",
                      minLength: 1,
                    },
                    day: {
                      type: "integer",
                      minimum: 0,
                    },
                  },
                  anyOf: [{ required: ["time"] }, { required: ["day"] }],
                  additionalProperties: true,
                },
              },
              additionalProperties: true,
            },
          },
        },
        required: ["styles", "datas", "sprites", "fonts"],
        additionalProperties: true,
      },
      cleanUp
    );
  }

  return cleanUp;
}

/**
 * Clean up MBTiles tiles
 * @param {string} sourcePath MBTiles folder path
 * @param {Array<number>} zooms Array of specific zoom levels
 * @param {Array<number>} bbox Bounding box in format [lonMin, latMin, lonMax, latMax] in EPSG:4326
 * @param {number} concurrency Concurrency download
 * @param {number} maxTry Number of retry attempts on failure
 * @param {boolean} storeMD5 Is store MD5 hashed?
 * @param {string|number} cleanUpBefore Date string in format "YYYY-MM-DDTHH:mm:ss" or number of days before which files should be deleted
 * @returns {Promise<void>}
 */
export async function cleanUpMBTilesTiles(
  sourcePath,
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
  const id = path.basename(sourcePath);
  const tilesSummary = getTileBoundsFromBBox(bbox, zooms, "xyz");
  let totalTasks = Object.values(tilesSummary).reduce(
    (total, tile) =>
      total + (tile.x[1] - tile.x[0] + 1) * (tile.y[1] - tile.y[0] + 1),
    0
  );
  let cleanUpTimestamp;
  let log = `Cleaning up ${totalTasks} tiles of mbtiles data id "${id}" with:\n\tConcurrency: ${concurrency}\n\tMax tries: ${maxTry}\n\tZoom levels: [${zooms.join(
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

  // Open MBTiles SQLite database
  const mbtilesSource = await openMBTilesDB(
    `${sourcePath}/${path.basename(sourcePath)}.mbtiles`,
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
          let needRemove = false;

          try {
            if (cleanUpTimestamp !== undefined) {
              try {
                const created = await getMBTilesTileCreated(
                  needRemove,
                  z,
                  x,
                  y
                );

                if (!created || created < cleanUpTimestamp) {
                  needRemove = true;
                }
              } catch (error) {
                if (error.message === "Tile created does not exist") {
                  needRemove = true;
                } else {
                  throw error;
                }
              }
            } else {
              needRemove = true;
            }

            if (needRemove === true) {
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
            printLog(
              "error",
              `Failed to clean up tile data "${tileName}": ${error}`
            );
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

  // Close MBTiles SQLite database
  if (mbtilesSource !== undefined) {
    await closeMBTiles(mbtilesSource);
  }
}

/**
 * Clean up XYZ tiles
 * @param {string} sourcePath XYZ folder path
 * @param {"jpeg"|"jpg"|"pbf"|"png"|"webp"|"gif"} format Tile format
 * @param {Array<number>} zooms Array of specific zoom levels
 * @param {Array<number>} bbox Bounding box in format [lonMin, latMin, lonMax, latMax] in EPSG:4326
 * @param {number} concurrency Concurrency to clean up
 * @param {number} maxTry Number of retry attempts on failure
 * @param {boolean} storeMD5 Is store MD5 hashed?
 * @param {string|number} cleanUpBefore Date string in format "YYYY-MM-DDTHH:mm:ss" or number of days before which files should be deleted
 * @returns {Promise<void>}
 */
export async function cleanUpXYZTiles(
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
  const id = path.basename(sourcePath);
  const tilesSummary = getTileBoundsFromBBox(bbox, zooms, "xyz");
  let totalTasks = Object.values(tilesSummary).reduce(
    (total, tile) =>
      total + (tile.x[1] - tile.x[0] + 1) * (tile.y[1] - tile.y[0] + 1),
    0
  );
  let cleanUpTimestamp;
  let log = `Cleaning up ${totalTasks} tiles of xyz data id "${id}" with:\n\tConcurrency: ${concurrency}\n\tMax tries: ${maxTry}\n\tZoom levels: [${zooms.join(
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

  // Open MD5 SQLite database
  const xyzSource = await openXYZMD5DB(
    sourcePath,
    sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE,
    true
  );

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
          let needRemove = false;

          try {
            if (cleanUpTimestamp !== undefined) {
              try {
                created = await getXYZTileCreated(
                  `${sourcePath}/${tileName}.${format}`
                );

                if (!created || created < cleanUpTimestamp) {
                  needRemove = true;
                }
              } catch (error) {
                if (error.message === "Tile created does not exist") {
                  needRemove = true;
                } else {
                  throw error;
                }
              }
            } else {
              needRemove = true;
            }

            if (needRemove === true) {
              await removeXYZTileDataFile(
                sourcePath,
                xyzSource,
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
            printLog(
              "error",
              `Failed to clean up tile "${tileName}": ${error}`
            );
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

  // Close MD5 SQLite database
  if (xyzSource !== undefined) {
    await closeXYZMD5DB(xyzSource);
  }

  // Remove parent folders if empty
  await removeEmptyFolders(
    sourcePath,
    /^.*\.(sqlite|json|gif|png|jpg|jpeg|webp|pbf)$/
  );
}

/**
 * Clean up style
 * @param {string} sourcePath Style folder path
 * @param {string|number} cleanUpBefore Date string in format "YYYY-MM-DDTHH:mm:ss" or number of days before which files should be deleted
 * @returns {Promise<void>}
 */
export async function cleanUpStyle(sourcePath, cleanUpBefore) {
  const id = path.basename(sourcePath);
  let cleanUpTimestamp;
  let log = `Cleaning up style id "${id}" with:\n\tMax tries: ${maxTry}`;

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
  let needRemove = false;

  try {
    if (cleanUpTimestamp !== undefined) {
      try {
        created = await getStyleCreated(filePath);

        if (!created || created < cleanUpTimestamp) {
          needRemove = true;
        }
      } catch (error) {
        if (error.message === "Style created does not exist") {
          needRemove = true;
        } else {
          throw error;
        }
      }
    } else {
      needRemove = true;
    }

    if (needRemove === true) {
      await removeStyleFile(
        filePath,
        maxTry,
        300000 // 5 mins
      );
    }
  } catch (error) {
    printLog("error", `Failed to clean up style id "${id}": ${error}`);
  }

  // Remove parent folders if empty
  await removeEmptyFolders(sourcePath, /^.*\.json$/);
}
