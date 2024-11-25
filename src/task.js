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
    const ids = Object.keys(cleanUpData.styles);

    printLog("info", `Starting clean up ${ids.length} styles...`);

    const startTime = Date.now();

    for (const id of ids) {
      const cleanUpStyleItem = cleanUpData.styles[id];
      const cleanUpData =
        cleanUpStyleItem.refreshBefore?.time ||
        cleanUpStyleItem.refreshBefore?.day;

      try {
        await cleanUpStyle(`${dataDir}/caches/styles/${id}`, cleanUpData);
      } catch (error) {
        printLog(
          "error",
          `Failed to clean up style "${id}": ${error}. Skipping...`
        );
      }
    }

    const doneTime = Date.now();

    printLog(
      "info",
      `Completed clean up styles after: ${(doneTime - startTime) / 1000}s!`
    );
  } catch (error) {
    printLog("error", `Failed to clean up styles: ${error}. Exited!`);
  }

  try {
    const ids = Object.keys(cleanUpData.datas);

    printLog("info", `Starting clean up ${ids.length} datas...`);

    const startTime = Date.now();

    for (const id of ids) {
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
          `Failed to clean up data "${id}": ${error}. Skipping...`
        );
      }
    }

    const doneTime = Date.now();

    printLog(
      "info",
      `Completed clean up datas after: ${(doneTime - startTime) / 1000}s!`
    );
  } catch (error) {
    printLog("error", `Failed to clean up datas: ${error}. Exited!`);
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
    const ids = Object.keys(seedData.styles);

    printLog("info", `Starting seed ${ids.length} styles...`);

    const startTime = Date.now();

    for (const id of ids) {
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
          `Failed to seed style "${id}": ${error}. Skipping...`
        );
      }
    }

    const doneTime = Date.now();

    printLog(
      "info",
      `Completed seed styles after: ${(doneTime - startTime) / 1000}s!`
    );
  } catch (error) {
    printLog("error", `Failed to seed styles: ${error}. Exited!`);
  }

  try {
    const ids = Object.keys(seedData.datas);

    printLog("info", `Starting seed ${ids.length} datas...`);

    const startTime = Date.now();

    for (const id of ids) {
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
        printLog("error", `Failed to seed data "${id}": ${error}. Skipping...`);
      }
    }

    const doneTime = Date.now();

    printLog(
      "info",
      `Completed seed datas after: ${(doneTime - startTime) / 1000}s!`
    );
  } catch (error) {
    printLog("error", `Failed to seed datas: ${error}. Exited!`);
  }
}
