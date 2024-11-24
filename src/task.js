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

    const startTime = Date.now();

    for (const id in cleanUpData.styles) {
      const cleanUpStyleItem = cleanUpData.styles[id];
      const cleanUpData =
        cleanUpStyleItem.refreshBefore?.time ||
        cleanUpStyleItem.refreshBefore?.day;

      try {
        await cleanUpStyle(`${dataDir}/caches/styles/${id}`, cleanUpData);
      } catch (error) {
        printLog(
          "error",
          `Failed to clean up style id "${id}": ${error}. Skipping...`
        );
      }
    }

    const doneTime = Date.now();

    printLog(
      "info",
      `Completed clean up style after: ${(doneTime - startTime) / 1000}s!`
    );
  } catch (error) {
    printLog("error", `Failed to clean up style: ${error}. Exited!`);
  }

  try {
    printLog(
      "info",
      `Starting clean up ${Object.keys(cleanUpData.datas).length} datas...`
    );

    const startTime = Date.now();

    for (const id in cleanUpData.datas) {
      const seedDataItem = seedData.datas[id];
      const cleanUpDataItem = cleanUpData.datas[id];
      const cleanUpBefore =
        cleanUpDataItem.cleanUpBefore?.time ||
        cleanUpDataItem.cleanUpBefore?.day;

      try {
        if (seedDataItem.storeType === "xyz") {
          await cleanUpXYZTiles(
            `${dataDir}/caches/xyzs/${id}`,
            seedDataItem.metadata.format,
            cleanUpDataItem.zooms,
            cleanUpDataItem.bbox,
            seedDataItem.concurrency,
            seedDataItem.maxTry,
            seedDataItem.storeMD5,
            cleanUpBefore
          );
        } else if (seedDataItem.storeType === "mbtiles") {
          await cleanUpMBTilesTiles(
            `${dataDir}/caches/mbtiles/${id}`,
            cleanUpDataItem.zooms,
            cleanUpDataItem.bbox,
            seedDataItem.concurrency,
            seedDataItem.maxTry,
            cleanUpBefore
          );
        }
      } catch (error) {
        printLog(
          "error",
          `Failed to clean up data id "${id}": ${error}. Skipping...`
        );
      }
    }

    const doneTime = Date.now();

    printLog(
      "info",
      `Completed clean up data after: ${(doneTime - startTime) / 1000}s!`
    );
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

    const startTime = Date.now();

    for (const id in seedData.styles) {
      const seedStyleItem = seedData.styles[id];
      const refreshBefore =
        seedStyleItem.refreshBefore?.time || seedStyleItem.refreshBefore?.day;

      try {
        await seedStyle(
          `${dataDir}/caches/styles/${id}`,
          seedStyleItem.url,
          seedStyleItem.maxTry,
          seedStyleItem.timeout,
          refreshBefore
        );
      } catch (error) {
        printLog(
          "error",
          `Failed to seed style id "${id}": ${error}. Skipping...`
        );
      }
    }

    const doneTime = Date.now();

    printLog(
      "info",
      `Completed seed style after: ${(doneTime - startTime) / 1000}s!`
    );
  } catch (error) {
    printLog("error", `Failed to seed style: ${error}. Exited!`);
  }

  try {
    printLog(
      "info",
      `Starting seed ${Object.keys(seedData.datas).length} datas...`
    );

    const startTime = Date.now();

    for (const id in seedData.datas) {
      const seedDataItem = seedData.datas[id];
      const refreshBefore =
        seedDataItem.refreshBefore?.time ||
        seedDataItem.refreshBefore?.day ||
        seedDataItem.refreshBefore?.md5;

      try {
        if (seedDataItem.storeType === "xyz") {
          await seedXYZTiles(
            `${dataDir}/caches/xyzs/${id}`,
            seedDataItem.metadata,
            seedDataItem.url,
            seedDataItem.bbox,
            seedDataItem.zooms,
            seedDataItem.concurrency,
            seedDataItem.maxTry,
            seedDataItem.timeout,
            seedDataItem.storeMD5,
            seedDataItem.storeTransparent,
            refreshBefore
          );
        } else if (seedDataItem.storeType === "mbtiles") {
          await seedMBTilesTiles(
            `${dataDir}/caches/mbtiles/${id}`,
            seedDataItem.metadata,
            seedDataItem.url,
            seedDataItem.bbox,
            seedDataItem.zooms,
            seedDataItem.concurrency,
            seedDataItem.maxTry,
            seedDataItem.timeout,
            seedDataItem.storeMD5,
            seedDataItem.storeTransparent,
            refreshBefore
          );
        }
      } catch (error) {
        printLog(
          "error",
          `Failed to seed data id "${id}": ${error}. Skipping...`
        );
      }
    }

    const doneTime = Date.now();

    printLog(
      "info",
      `Completed seed data after: ${(doneTime - startTime) / 1000}s!`
    );
  } catch (error) {
    printLog("error", `Failed to seed data: ${error}. Exited!`);
  }
}
