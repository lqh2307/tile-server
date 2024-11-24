"use strict";

import { printLog } from "./logger.js";
import {
  cleanUpMBTilesTiles,
  cleanUpXYZTiles,
  readCleanUpFile,
  cleanUpStyle,
} from "./cleanup.js";
import {
  seedMBTilesTiles,
  readSeedFile,
  seedXYZTiles,
  seedStyle,
} from "./seed.js";

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
  await runCleanUpTask(dataDir, cleanUpData, seedData);

  /* Run seed task */
  await runSeedTask(dataDir, seedData);
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
        if (seedData.datas[id].storeType === "xyz") {
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
        } else if (seedData.datas[id].storeType === "mbtiles") {
          await cleanUpMBTilesTiles(
            `${dataDir}/caches/mbtiles/${id}`,
            seedData.datas[id].metadata.format,
            cleanUpData.datas[id].zooms,
            cleanUpData.datas[id].bbox,
            seedData.datas[id].concurrency,
            seedData.datas[id].maxTry,
            seedData.datas[id].storeMD5,
            cleanUpData.datas[id].cleanUpBefore?.time ||
              cleanUpData.datas[id].cleanUpBefore?.day
          );
        }
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
        if (seedData.datas[id].storeType === "xyz") {
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
        } else if (seedData.datas[id].storeType === "mbtiles") {
          await seedMBTilesTiles(
            `${dataDir}/caches/mbtiles/${id}`,
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
        }
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
