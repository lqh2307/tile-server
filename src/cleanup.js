"use strict";

import { getGeoJSONCreated, removeGeoJSONFile } from "./geojson.js";
import { getSpriteCreated, removeSpriteFile } from "./sprite.js";
import { removeStyleFile, getStyleCreated } from "./style.js";
import { getFontCreated, removeFontFile } from "./font.js";
import fsPromise from "node:fs/promises";
import { printLog } from "./logger.js";
import { Mutex } from "async-mutex";
import sqlite3 from "sqlite3";
import {
  getXYZTileCreated,
  removeXYZTile,
  closeXYZMD5DB,
  openXYZMD5DB,
} from "./tile_xyz.js";
import {
  getMBTilesTileCreated,
  removeMBTilesTile,
  compactMBTiles,
  closeMBTilesDB,
  openMBTilesDB,
} from "./tile_mbtiles.js";
import {
  getTilesBoundsFromBBoxs,
  createFileWithLock,
  removeEmptyFolders,
  getJSONSchema,
  validateJSON,
  delay,
} from "./utils.js";
import {
  getPostgreSQLTileCreated,
  removePostgreSQLTile,
  closePostgreSQLDB,
  openPostgreSQLDB,
} from "./tile_postgresql.js";

let cleanUp;

/**
 * Read cleanup.json file
 * @param {boolean} isValidate Is validate file content?
 * @returns {Promise<object>}
 */
async function readCleanUpFile(isValidate) {
  /* Read cleanup.json file */
  const data = await fsPromise.readFile(
    `${process.env.DATA_DIR}/cleanup.json`,
    "utf8"
  );

  const cleanUp = JSON.parse(data);

  /* Validate cleanup.json file */
  if (isValidate === true) {
    validateJSON(await getJSONSchema("cleanup"), cleanUp);
  }

  return cleanUp;
}

/**
 * Load cleanup.json file content to global variable
 * @returns {Promise<void>}
 */
async function loadCleanUpFile() {
  cleanUp = await readCleanUpFile(true);
}

/**
 * Update cleanup.json file content with lock
 * @param {Object<any>} cleanUp Clean up object
 * @param {number} timeout Timeout in milliseconds
 * @returns {Promise<void>}
 */
async function updateCleanUpFile(cleanUp, timeout) {
  await createFileWithLock(
    `${process.env.DATA_DIR}/cleanup.json`,
    JSON.stringify(cleanUp, null, 2),
    timeout
  );
}

/**
 * Clean up MBTiles tiles
 * @param {string} id Clean up MBTiles ID
 * @param {Array<number>} zooms Array of specific zoom levels
 * @param {Array<Array<number>>} bboxs Array of bounding box in format [[lonMin, latMin, lonMax, latMax]] in EPSG:4326
 * @param {string|number} cleanUpBefore Date string in format "YYYY-MM-DDTHH:mm:ss" or number of days before which files should be deleted
 * @returns {Promise<void>}
 */
async function cleanUpMBTilesTiles(id, zooms, bboxs, cleanUpBefore) {
  const startTime = Date.now();

  const { total, tilesSummaries } = getTilesBoundsFromBBoxs(
    bboxs,
    zooms,
    "xyz"
  );

  let log = `Cleaning up ${total} tiles of mbtiles "${id}" with:\n\tZoom levels: [${zooms.join(
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

  /* Open MBTiles SQLite database */
  const source = await openMBTilesDB(
    `${process.env.DATA_DIR}/caches/mbtiles/${id}/${id}.mbtiles`,
    sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE,
    false
  );

  /* Remove tiles */
  const mutex = new Mutex();

  let activeTasks = 0;
  let completeTasks = 0;

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
        printLog(
          "info",
          `Removing data "${id}" - Tile "${tileName}" - ${completeTasks}/${total}...`
        );

        await removeMBTilesTile(
          source,
          z,
          x,
          y,
          300000 // 5 mins
        );
      }
    } catch (error) {
      printLog(
        "error",
        `Failed to clean up data "${id}" - Tile "${tileName}" - ${completeTasks}/${total}: ${error}`
      );
    }
  }

  printLog("info", "Removing datas...");

  for (const tilesSummary of tilesSummaries) {
    for (const z in tilesSummary) {
      for (let x = tilesSummary[z].x[0]; x <= tilesSummary[z].x[1]; x++) {
        for (let y = tilesSummary[z].y[0]; y <= tilesSummary[z].y[1]; y++) {
          /* Wait slot for a task */
          while (activeTasks >= 200) {
            await delay(50);
          }

          await mutex.runExclusive(() => {
            activeTasks++;

            completeTasks++;
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

  /* Compact MBTiles */
  await compactMBTiles(source);

  /* Close MBTiles SQLite database */
  if (source !== undefined) {
    await closeMBTilesDB(source);
  }

  const doneTime = Date.now();

  printLog(
    "info",
    `Completed clean up ${total} tiles of mbtiles "${id}" after ${
      (doneTime - startTime) / 1000
    }s!`
  );
}

/**
 * Clean up PostgreSQL tiles
 * @param {string} id Clean up PostgreSQL ID
 * @param {Array<number>} zooms Array of specific zoom levels
 * @param {Array<Array<number>>} bboxs Array of bounding box in format [[lonMin, latMin, lonMax, latMax]] in EPSG:4326
 * @param {string|number} cleanUpBefore Date string in format "YYYY-MM-DDTHH:mm:ss" or number of days before which files should be deleted
 * @returns {Promise<void>}
 */
async function cleanUpPostgreSQLTiles(id, zooms, bboxs, cleanUpBefore) {
  const startTime = Date.now();

  const { total, tilesSummaries } = getTilesBoundsFromBBoxs(
    bboxs,
    zooms,
    "xyz"
  );

  let log = `Cleaning up ${total} tiles of postgresql "${id}" with:\n\tZoom levels: [${zooms.join(
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

  /* Open PostgreSQL database */
  const source = await openPostgreSQLDB(
    `${process.env.POSTGRESQL_BASE_URI}/${id}`,
    true
  );

  /* Remove tiles */
  const mutex = new Mutex();

  let activeTasks = 0;
  let completeTasks = 0;

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
        printLog(
          "info",
          `Removing data "${id}" - Tile "${tileName}" - ${completeTasks}/${total}...`
        );

        await removePostgreSQLTile(
          source,
          z,
          x,
          y,
          300000 // 5 mins
        );
      }
    } catch (error) {
      printLog(
        "error",
        `Failed to clean up data "${id}" - Tile "${tileName}" - ${completeTasks}/${total}: ${error}`
      );
    }
  }

  printLog("info", "Removing datas...");

  for (const tilesSummary of tilesSummaries) {
    for (const z in tilesSummary) {
      for (let x = tilesSummary[z].x[0]; x <= tilesSummary[z].x[1]; x++) {
        for (let y = tilesSummary[z].y[0]; y <= tilesSummary[z].y[1]; y++) {
          /* Wait slot for a task */
          while (activeTasks >= 200) {
            await delay(50);
          }

          await mutex.runExclusive(() => {
            activeTasks++;

            completeTasks++;
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

  /* Close PostgreSQL database */
  if (source !== undefined) {
    await closePostgreSQLDB(source);
  }

  const doneTime = Date.now();

  printLog(
    "info",
    `Completed clean up ${total} tiles of postgresql "${id}" after ${
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
 * @param {string|number} cleanUpBefore Date string in format "YYYY-MM-DDTHH:mm:ss" or number of days before which files should be deleted
 * @returns {Promise<void>}
 */
async function cleanUpXYZTiles(id, format, zooms, bboxs, cleanUpBefore) {
  const startTime = Date.now();

  const { total, tilesSummaries } = getTilesBoundsFromBBoxs(
    bboxs,
    zooms,
    "xyz"
  );

  let log = `Cleaning up ${total} tiles of xyz "${id}" with:\n\tZoom levels: [${zooms.join(
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

  /* Open XYZ MD5 SQLite database */
  const source = await openXYZMD5DB(
    `${process.env.DATA_DIR}/caches/xyzs/${id}/${id}.sqlite`,
    sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE,
    false
  );

  /* Remove tile files */
  const mutex = new Mutex();

  let activeTasks = 0;
  let completeTasks = 0;

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
        printLog(
          "info",
          `Removing data "${id}" - Tile "${tileName}" - ${completeTasks}/${total}...`
        );

        await removeXYZTile(
          id,
          source,
          z,
          x,
          y,
          format,
          300000 // 5 mins
        );
      }
    } catch (error) {
      printLog(
        "error",
        `Failed to clean up data "${id}" - Tile "${tileName}" - ${completeTasks}/${total}: ${error}`
      );
    }
  }

  printLog("info", "Removing datas...");

  for (const tilesSummary of tilesSummaries) {
    for (const z in tilesSummary) {
      for (let x = tilesSummary[z].x[0]; x <= tilesSummary[z].x[1]; x++) {
        for (let y = tilesSummary[z].y[0]; y <= tilesSummary[z].y[1]; y++) {
          /* Wait slot for a task */
          while (activeTasks >= 200) {
            await delay(50);
          }

          await mutex.runExclusive(() => {
            activeTasks++;

            completeTasks++;
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

  /* Close XYZ MD5 SQLite database */
  if (source !== undefined) {
    await closeXYZMD5DB(source);
  }

  /* Remove parent folders if empty */
  await removeEmptyFolders(
    `${process.env.DATA_DIR}/caches/xyzs/${id}`,
    /^.*\.(sqlite|json|gif|png|jpg|jpeg|webp|pbf)$/
  );

  const doneTime = Date.now();

  printLog(
    "info",
    `Completed clean up ${total} tiles of xyz "${id}" after ${
      (doneTime - startTime) / 1000
    }s!`
  );
}

/**
 * Clean up geojson
 * @param {string} id Clean up geojson ID
 * @param {string|number} cleanUpBefore Date string in format "YYYY-MM-DDTHH:mm:ss" or number of days before which files should be deleted
 * @returns {Promise<void>}
 */
async function cleanUpGeoJSON(id, cleanUpBefore) {
  const startTime = Date.now();

  let log = `Cleaning up geojson "${id}" with:`;

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

  /* Remove GeoJSON file */
  const filePath = `${process.env.DATA_DIR}/caches/geojsons/${id}/${id}.geojson`;

  try {
    let needRemove = false;

    if (cleanUpTimestamp !== undefined) {
      try {
        const created = await getGeoJSONCreated(filePath);

        if (!created || created < cleanUpTimestamp) {
          needRemove = true;
        }
      } catch (error) {
        if (error.message === "GeoJSON created does not exist") {
          needRemove = true;
        } else {
          throw error;
        }
      }
    } else {
      needRemove = true;
    }

    printLog("info", "Removing geojson...");

    if (needRemove === true) {
      printLog("info", `Removing geojson "${id}" - File "${filePath}"...`);

      await removeGeoJSONFile(
        filePath,
        300000 // 5 mins
      );
    }
  } catch (error) {
    printLog("error", `Failed to clean up geojson "${id}": ${error}`);
  }

  /* Remove parent folders if empty */
  await removeEmptyFolders(
    `${process.env.DATA_DIR}/caches/geojsons/${id}`,
    /^.*\.geojson$/
  );

  const doneTime = Date.now();

  printLog(
    "info",
    `Completed clean up geojson "${id}" after ${
      (doneTime - startTime) / 1000
    }s!`
  );
}

/**
 * Clean up sprite
 * @param {string} id Clean up sprite ID
 * @param {string|number} cleanUpBefore Date string in format "YYYY-MM-DDTHH:mm:ss" or number of days before which files should be deleted
 * @returns {Promise<void>}
 */
async function cleanUpSprite(id, cleanUpBefore) {
  const startTime = Date.now();

  let log = `Cleaning up sprite "${id}" with:`;

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

  /* Remove sprite files */
  async function cleanUpSpriteData(fileName) {
    const filePath = `${process.env.DATA_DIR}/caches/sprites/${id}/${fileName}`;

    try {
      let needRemove = false;

      if (cleanUpTimestamp !== undefined) {
        try {
          const created = await getSpriteCreated(filePath);

          if (!created || created < cleanUpTimestamp) {
            needRemove = true;
          }
        } catch (error) {
          if (error.message === "Sprite created does not exist") {
            needRemove = true;
          } else {
            throw error;
          }
        }
      } else {
        needRemove = true;
      }

      if (needRemove === true) {
        printLog("info", `Removing sprite "${id}" - File "${fileName}"...`);

        await removeSpriteFile(
          filePath,
          300000 // 5 mins
        );
      }
    } catch (error) {
      printLog(
        "error",
        `Failed to clean up sprite "${id}" - File "${fileName}": ${error}`
      );
    }
  }

  printLog("info", "Removing sprites...");

  await Promise.all(
    ["sprite.json", "sprite.png", "sprite@2x.json", "sprite@2x.png"].map(
      (fileName) => cleanUpSpriteData(fileName)
    )
  );

  /* Remove parent folders if empty */
  await removeEmptyFolders(
    `${process.env.DATA_DIR}/caches/geojsons/${id}`,
    /^.*\.(json|png)$/
  );

  const doneTime = Date.now();

  printLog(
    "info",
    `Completed clean up geojson "${id}" after ${
      (doneTime - startTime) / 1000
    }s!`
  );
}

/**
 * Clean up font
 * @param {string} id Clean up font ID
 * @param {string|number} cleanUpBefore Date string in format "YYYY-MM-DDTHH:mm:ss" or number of days before which files should be deleted
 * @returns {Promise<void>}
 */
async function cleanUpFont(id, cleanUpBefore) {
  const startTime = Date.now();

  let log = `Cleaning up font "${id}" with:`;

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

  /* Remove font files */
  async function cleanUpFontData(start, end) {
    const range = `${start}-${end}`;
    const filePath = `${process.env.DATA_DIR}/caches/fonts/${id}/${range}.pbf`;

    try {
      let needRemove = false;

      if (cleanUpTimestamp !== undefined) {
        try {
          const created = await getFontCreated(filePath);

          if (!created || created < cleanUpTimestamp) {
            needRemove = true;
          }
        } catch (error) {
          if (error.message === "Font created does not exist") {
            needRemove = true;
          } else {
            throw error;
          }
        }
      } else {
        needRemove = true;
      }

      if (needRemove === true) {
        printLog("info", `Removing font "${id}" - Range "${range}"...`);

        await removeFontFile(
          filePath,
          300000 // 5 mins
        );
      }
    } catch (error) {
      printLog(
        "error",
        `Failed to clean up font "${id}" -  Range "${range}": ${error}`
      );
    }
  }

  printLog("info", "Removing fonts...");

  await Promise.all(
    Array.from({ length: 256 }, (_, i) =>
      cleanUpFontData(i * 256, i * 256 + 255)
    )
  );

  /* Remove parent folders if empty */
  await removeEmptyFolders(
    `${process.env.DATA_DIR}/caches/fonts/${id}`,
    /^.*\.pbf$/
  );

  const doneTime = Date.now();

  printLog(
    "info",
    `Completed clean up geojson "${id}" after ${
      (doneTime - startTime) / 1000
    }s!`
  );
}

/**
 * Clean up style
 * @param {string} id Clean up style ID
 * @param {string|number} cleanUpBefore Date string in format "YYYY-MM-DDTHH:mm:ss" or number of days before which files should be deleted
 * @returns {Promise<void>}
 */
async function cleanUpStyle(id, cleanUpBefore) {
  const startTime = Date.now();

  let log = `Cleaning up style "${id}" with:`;

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

  /* Remove style.json file */
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

    printLog("info", "Removing style...");

    if (needRemove === true) {
      printLog("info", `Removing style "${id}" - File "${filePath}"...`);

      await removeStyleFile(
        filePath,
        300000 // 5 mins
      );
    }
  } catch (error) {
    printLog("error", `Failed to clean up style "${id}": ${error}`);
  }

  /* Remove parent folders if empty */
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

export {
  cleanUpPostgreSQLTiles,
  cleanUpMBTilesTiles,
  updateCleanUpFile,
  readCleanUpFile,
  loadCleanUpFile,
  cleanUpXYZTiles,
  cleanUpGeoJSON,
  cleanUpSprite,
  cleanUpStyle,
  cleanUpFont,
  cleanUp,
};
