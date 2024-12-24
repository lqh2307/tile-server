"use strict";

import { getStyleCreated, removeStyleFile } from "./style.js";
import { OPEN_READWRITE, OPEN_CREATE } from "sqlite3";
import fsPromise from "node:fs/promises";
import { printLog } from "./logger.js";
import { Mutex } from "async-mutex";
import os from "os";
import {
  removeXYZTileDataFile,
  getXYZTileCreated,
  closeXYZMD5DB,
  openXYZMD5DB,
} from "./tile_xyz.js";
import {
  removeMBTilesTileData,
  getMBTilesTileCreated,
  closeMBTilesDB,
  openMBTilesDB,
} from "./tile_mbtiles.js";
import {
  getTilesBoundsFromBBoxs,
  removeEmptyFolders,
  validateJSON,
  delay,
} from "./utils.js";
import {
  getPostgreSQLTileCreated,
  removePostgreSQLTileData,
  closePostgreSQLDB,
  openPostgreSQLDB,
} from "./tile_postgresql.js";

/**
 * Read cleanup.json file
 * @param {boolean} isValidate Is validate file?
 * @returns {Promise<object>}
 */
export async function readCleanUpFile(isValidate) {
  /* Read cleanup.json file */
  const data = await fsPromise.readFile(
    `${process.env.DATA_DIR}/cleanup.json`,
    "utf8"
  );

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
                skip: {
                  type: "boolean",
                },
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
                },
              },
            },
          },
          datas: {
            type: "object",
            additionalProperties: {
              type: "object",
              properties: {
                bboxs: {
                  type: "array",
                  items: {
                    type: "array",
                    items: {
                      type: "number",
                      minimum: -180,
                      maximum: 180,
                    },
                    minItems: 4,
                    maxItems: 4,
                  },
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
                skip: {
                  type: "boolean",
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
                },
              },
            },
          },
          sprites: {
            type: "object",
            additionalProperties: {
              type: "object",
              properties: {
                skip: {
                  type: "boolean",
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
                },
              },
            },
          },
          fonts: {
            type: "object",
            additionalProperties: {
              type: "object",
              properties: {
                skip: {
                  type: "boolean",
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
                },
              },
            },
          },
        },
        required: ["styles", "datas", "sprites", "fonts"],
      },
      cleanUp
    );
  }

  return cleanUp;
}

/**
 * Clean up MBTiles tiles
 * @param {string} id Clean up MBTiles ID
 * @param {Array<number>} zooms Array of specific zoom levels
 * @param {Array<Array<number>>} bboxs Array of bounding box in format [[lonMin, latMin, lonMax, latMax]] in EPSG:4326
 * @param {number} concurrency Concurrency download
 * @param {number} maxTry Number of retry attempts on failure
 * @param {string|number} cleanUpBefore Date string in format "YYYY-MM-DDTHH:mm:ss" or number of days before which files should be deleted
 * @returns {Promise<void>}
 */
export async function cleanUpMBTilesTiles(
  id,
  zooms = [
    0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20,
    21, 22,
  ],
  bboxs = [[-180, -85.051129, 180, 85.051129]],
  concurrency = os.cpus().length,
  maxTry = 5,
  cleanUpBefore
) {
  const startTime = Date.now();

  const { total, tilesSummaries } = getTilesBoundsFromBBoxs(
    bboxs,
    zooms,
    "xyz"
  );

  let log = `Cleaning up ${total} tiles of mbtiles data "${id}" with:\n\tConcurrency: ${concurrency}\n\tMax try: ${maxTry}\n\tZoom levels: [${zooms.join(
    ", "
  )}]\n\tBBoxs: [${bboxs.map((bbox) => `[${bbox.join(", ")}]`).join(", ")}]`;

  let cleanUpTimestamp;
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
  const source = await openMBTilesDB(
    `${process.env.DATA_DIR}/caches/mbtiles/${id}/${id}.mbtiles`,
    OPEN_READWRITE | OPEN_CREATE,
    false
  );

  // Remove tiles
  const mutex = new Mutex();

  let activeTasks = 0;
  let remainingTasks = total;

  async function cleanUpMBTilesTileData(z, x, y) {
    const tileName = `${z}/${x}/${y}`;

    try {
      let needRemove = false;

      if (cleanUpTimestamp !== undefined) {
        try {
          const created = await getMBTilesTileCreated(source, z, x, y);

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
          source,
          z,
          x,
          y,
          maxTry,
          300000 // 5 mins
        );
      }
    } catch (error) {
      printLog(
        "error",
        `Failed to clean up data "${id}" - Tile "${tileName}": ${error}`
      );
    }
  }

  printLog("info", "Removing datas...");

  for (const tilesSummary of tilesSummaries) {
    for (const z in tilesSummary) {
      for (let x = tilesSummary[z].x[0]; x <= tilesSummary[z].x[1]; x++) {
        for (let y = tilesSummary[z].y[0]; y <= tilesSummary[z].y[1]; y++) {
          /* Wait slot for a task */
          while (activeTasks >= concurrency) {
            await delay(50);
          }

          await mutex.runExclusive(() => {
            activeTasks++;

            remainingTasks--;
          });

          /* Run a task */
          cleanUpMBTilesTileData(z, x, y).finally(() =>
            mutex.runExclusive(() => {
              activeTasks--;
            })
          );
        }
      }
    }
  }

  /* Wait all tasks done */
  while (activeTasks > 0) {
    await delay(50);
  }

  // Close MBTiles SQLite database
  if (source !== undefined) {
    await closeMBTilesDB(source);
  }

  const doneTime = Date.now();

  printLog(
    "info",
    `Completed clean up ${total} tiles of mbtiles data "${id}" after ${
      (doneTime - startTime) / 1000
    }s!`
  );
}

/**
 * Clean up PostgreSQL tiles
 * @param {string} id Clean up PostgreSQL ID
 * @param {Array<number>} zooms Array of specific zoom levels
 * @param {Array<Array<number>>} bboxs Array of bounding box in format [[lonMin, latMin, lonMax, latMax]] in EPSG:4326
 * @param {number} concurrency Concurrency download
 * @param {number} maxTry Number of retry attempts on failure
 * @param {string|number} cleanUpBefore Date string in format "YYYY-MM-DDTHH:mm:ss" or number of days before which files should be deleted
 * @returns {Promise<void>}
 */
export async function cleanUpPostgreSQLTiles(
  id,
  zooms = [
    0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20,
    21, 22,
  ],
  bboxs = [[-180, -85.051129, 180, 85.051129]],
  concurrency = os.cpus().length,
  maxTry = 5,
  cleanUpBefore
) {
  const startTime = Date.now();

  const { total, tilesSummaries } = getTilesBoundsFromBBoxs(
    bboxs,
    zooms,
    "xyz"
  );

  let log = `Cleaning up ${total} tiles of postgresql data "${id}" with:\n\tConcurrency: ${concurrency}\n\tMax try: ${maxTry}\n\tZoom levels: [${zooms.join(
    ", "
  )}]\n\tBBoxs: [${bboxs.map((bbox) => `[${bbox.join(", ")}]`).join(", ")}]`;

  let cleanUpTimestamp;
  if (typeof cleanUpBefore === "string") {
    cleanUpTimestamp = new Date(cleanUpBefore).getTime();

    log += `\n\tClean up before: ${cleanUpBefore}`;
  } else if (typeof cleanUpBefore === "number") {
    const now = new Date();

    cleanUpTimestamp = now.setDate(now.getDate() - cleanUpBefore);

    log += `\n\tOld than: ${cleanUpBefore} days`;
  }

  printLog("info", log);

  // Open PostgreSQL database
  const source = await openPostgreSQLDB(
    `${process.env.POSTGRESQL_BASE_URI}/${id}`,
    true
  );

  // Remove tiles
  const mutex = new Mutex();

  let activeTasks = 0;
  let remainingTasks = total;

  async function cleanUpPostgreSQLTileData(z, x, y) {
    const tileName = `${z}/${x}/${y}`;

    try {
      let needRemove = false;

      if (cleanUpTimestamp !== undefined) {
        try {
          const created = await getPostgreSQLTileCreated(source, z, x, y);

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
        await removePostgreSQLTileData(
          source,
          z,
          x,
          y,
          maxTry,
          300000 // 5 mins
        );
      }
    } catch (error) {
      printLog(
        "error",
        `Failed to clean up data "${id}" - Tile "${tileName}": ${error}`
      );
    }
  }

  printLog("info", "Removing datas...");

  for (const tilesSummary of tilesSummaries) {
    for (const z in tilesSummary) {
      for (let x = tilesSummary[z].x[0]; x <= tilesSummary[z].x[1]; x++) {
        for (let y = tilesSummary[z].y[0]; y <= tilesSummary[z].y[1]; y++) {
          /* Wait slot for a task */
          while (activeTasks >= concurrency) {
            await delay(50);
          }

          await mutex.runExclusive(() => {
            activeTasks++;

            remainingTasks--;
          });

          /* Run a task */
          cleanUpPostgreSQLTileData(z, x, y).finally(() =>
            mutex.runExclusive(() => {
              activeTasks--;
            })
          );
        }
      }
    }
  }

  /* Wait all tasks done */
  while (activeTasks > 0) {
    await delay(50);
  }

  // Close PostgreSQL database
  if (source !== undefined) {
    await closePostgreSQLDB(source);
  }

  const doneTime = Date.now();

  printLog(
    "info",
    `Completed clean up ${total} tiles of postgresql data "${id}" after ${
      (doneTime - startTime) / 1000
    }s!`
  );
}

/**
 * Clean up XYZ tiles
 * @param {string} id Clean up XYZ ID
 * @param {"jpeg"|"jpg"|"pbf"|"png"|"webp"|"gif"} format Tile format
 * @param {Array<number>} zooms Array of specific zoom levels
 * @param {Array<Array<number>>} bboxs Array of bounding box in format [[lonMin, latMin, lonMax, latMax]] in EPSG:4326
 * @param {number} concurrency Concurrency to clean up
 * @param {number} maxTry Number of retry attempts on failure
 * @param {string|number} cleanUpBefore Date string in format "YYYY-MM-DDTHH:mm:ss" or number of days before which files should be deleted
 * @returns {Promise<void>}
 */
export async function cleanUpXYZTiles(
  id,
  format,
  zooms = [
    0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20,
    21, 22,
  ],
  bboxs = [[-180, -85.051129, 180, 85.051129]],
  concurrency = os.cpus().length,
  maxTry = 5,
  cleanUpBefore
) {
  const startTime = Date.now();

  const { total, tilesSummaries } = getTilesBoundsFromBBoxs(
    bboxs,
    zooms,
    "xyz"
  );

  let log = `Cleaning up ${total} tiles of xyz data "${id}" with:\n\tConcurrency: ${concurrency}\n\tMax try: ${maxTry}\n\tZoom levels: [${zooms.join(
    ", "
  )}]\n\tBBoxs: [${bboxs.map((bbox) => `[${bbox.join(", ")}]`).join(", ")}]`;

  let cleanUpTimestamp;
  if (typeof cleanUpBefore === "string") {
    cleanUpTimestamp = new Date(cleanUpBefore).getTime();

    log += `\n\tClean up before: ${cleanUpBefore}`;
  } else if (typeof cleanUpBefore === "number") {
    const now = new Date();

    cleanUpTimestamp = now.setDate(now.getDate() - cleanUpBefore);

    log += `\n\tOld than: ${cleanUpBefore} days`;
  }

  printLog("info", log);

  // Open XYZ MD5 SQLite database
  const source = await openXYZMD5DB(
    `${process.env.DATA_DIR}/caches/xyzs/${id}/${id}.sqlite`,
    OPEN_READWRITE | OPEN_CREATE,
    false
  );

  // Remove tile files
  const mutex = new Mutex();

  let activeTasks = 0;
  let remainingTasks = total;

  async function cleanUpXYZTileData(z, x, y) {
    const tileName = `${z}/${x}/${y}`;

    try {
      let needRemove = false;

      if (cleanUpTimestamp !== undefined) {
        try {
          const created = await getXYZTileCreated(
            `${process.env.DATA_DIR}/caches/xyzs/${id}/${tileName}.${format}`
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
          id,
          source,
          z,
          x,
          y,
          format,
          maxTry,
          300000 // 5 mins
        );
      }
    } catch (error) {
      printLog(
        "error",
        `Failed to clean up data "${id}" - Tile "${tileName}": ${error}`
      );
    }
  }

  printLog("info", "Removing datas...");

  for (const tilesSummary of tilesSummaries) {
    for (const z in tilesSummary) {
      for (let x = tilesSummary[z].x[0]; x <= tilesSummary[z].x[1]; x++) {
        for (let y = tilesSummary[z].y[0]; y <= tilesSummary[z].y[1]; y++) {
          /* Wait slot for a task */
          while (activeTasks >= concurrency) {
            await delay(50);
          }

          await mutex.runExclusive(() => {
            activeTasks++;

            remainingTasks--;
          });

          /* Run a task */
          cleanUpXYZTileData(z, x, y).finally(() =>
            mutex.runExclusive(() => {
              activeTasks--;
            })
          );
        }
      }
    }
  }

  /* Wait all tasks done */
  while (activeTasks > 0) {
    await delay(50);
  }

  // Close XYZ MD5 SQLite database
  if (source !== undefined) {
    await closeXYZMD5DB(source);
  }

  // Remove parent folders if empty
  await removeEmptyFolders(
    `${process.env.DATA_DIR}/caches/xyzs/${id}`,
    /^.*\.(sqlite|json|gif|png|jpg|jpeg|webp|pbf)$/
  );

  const doneTime = Date.now();

  printLog(
    "info",
    `Completed clean up ${total} tiles of xyz data "${id}" after ${
      (doneTime - startTime) / 1000
    }s!`
  );
}

/**
 * Clean up style
 * @param {string} id Clean up style ID
 * @param {number} maxTry Number of retry attempts on failure
 * @param {string|number} cleanUpBefore Date string in format "YYYY-MM-DDTHH:mm:ss" or number of days before which files should be deleted
 * @returns {Promise<void>}
 */
export async function cleanUpStyle(id, maxTry = 5, cleanUpBefore) {
  const startTime = Date.now();

  let log = `Cleaning up style "${id}" with:\n\tMax try: ${maxTry}`;

  let cleanUpTimestamp;
  if (typeof cleanUpBefore === "string") {
    cleanUpTimestamp = new Date(cleanUpBefore).getTime();

    log += `\n\tClean up before: ${cleanUpBefore}`;
  } else if (typeof cleanUpBefore === "number") {
    const now = new Date();

    cleanUpTimestamp = now.setDate(now.getDate() - cleanUpBefore);

    log += `\n\tOld than: ${cleanUpBefore} days`;
  }

  printLog("info", log);

  // Remove style file
  const filePath = `${process.env.DATA_DIR}/caches/styles/${id}/style.json`;

  try {
    let needRemove = false;

    if (cleanUpTimestamp !== undefined) {
      try {
        const created = await getStyleCreated(filePath);

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
    printLog("error", `Failed to clean up style "${id}": ${error}`);
  }

  // Remove parent folders if empty
  await removeEmptyFolders(
    `${process.env.DATA_DIR}/caches/styles/${id}`,
    /^.*\.json$/
  );

  const doneTime = Date.now();

  printLog(
    "info",
    `Completed clean up style "${id}" after ${(doneTime - startTime) / 1000}s!`
  );
}
