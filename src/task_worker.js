"use strict";

import { cleanXYZTileDataFiles, seedXYZTileDataFiles } from "./seed_and_cleanup.js";
import { parentPort, workerData } from "node:worker_threads";
import { readCleanUpFile, readSeedFile } from "./config.js";
import fsPromise from "node:fs/promises";
import { printLog } from "./logger.js";

(async () => {
  try {
    await startTask(workerData.dataDir, workerData.removeOldCacheLocks, workerData.cleanUp, workerData.seed);

    parentPort.postMessage(true);
  } catch (error) {
    parentPort.postMessage({
      error: error.message,
    });
  }
})();

/**
 * Start task
 * @param {string} dataDir
 * @param {boolean} removeOldCacheLocks
 * @param {boolean} cleanUp
 * @param {boolean} seed
 * @returns {Promise<void>}
 */
async function startTask(dataDir, removeOldCacheLocks, cleanUp, seed) {
  printLog("info", "Starting seed and clean up task...");

  /* Remove old cache locks */
  if (removeOldCacheLocks) {
    printLog("info", `Starting remove old cache locks at "${dataDir}/caches"...`);

    await removeOldCacheLocks(`${dataDir}/caches`);
  }

  /* Read cleanup.json and seed.json files */
  printLog("info", `Loading seed.json and cleanup.json files at "${dataDir}"...`);

  if (!cleanUp && !seed) {
    printLog("info", `No seed or clean up task. Exited!`);
  }

  const [cleanUpData, seedData] = await Promise.all([readCleanUpFile(dataDir), readSeedFile(dataDir)]);

  /* Run clean up task */
  if (cleanUp) {
    try {
      printLog("info", `Starting clean up ${Object.keys(cleanUpData.datas).length} datas...`);

      for (const id in cleanUpData.datas) {
        try {
          await cleanXYZTileDataFiles(`${dataDir}/caches/xyzs/${id}`, seedData.datas[id].metadata.format, cleanUpData.datas[id].zooms, cleanUpData.datas[id].bbox, seedData.datas[id].concurrency, seedData.datas[id].maxTry, cleanUpData.datas[id].cleanUpBefore?.time || cleanUpData.datas[id].cleanUpBefore?.day);
        } catch (error) {
          printLog("error", `Failed to clean up data id "${id}": ${error}. Skipping...`);
        }
      }

      if (cleanUpData.restartServerAfterCleanUp === true) {
        printLog("info", "Completed cleaning up data. Restarting server...");

        process.kill(JSON.parse(await fsPromise.readFile("server-info.json", "utf8")).mainPID, "SIGTERM");
      } else {
        printLog("info", "Completed cleaning up data!");
      }
    } catch (error) {
      printLog("error", `Failed to clean up data: ${error}. Exited!`);
    }
  }

  /* Run seed task */
  if (seed) {
    try {
      printLog("info", `Starting seed ${Object.keys(seedData.datas).length} datas...`);

      for (const id in seedData.datas) {
        try {
          await seedXYZTileDataFiles(`${dataDir}/caches/xyzs/${id}`, seedData.datas[id].metadata, seedData.datas[id].url, seedData.datas[id].bbox, seedData.datas[id].zooms, seedData.datas[id].concurrency, seedData.datas[id].maxTry, seedData.datas[id].timeout, seedData.datas[id].refreshBefore?.time || seedData.datas[id].refreshBefore?.day || seedData.datas[id].refreshBefore?.md5);
        } catch (error) {
          printLog("error", `Failed to seed data id "${id}": ${error}. Skipping...`);
        }
      }

      if (seedData.restartServerAfterSeed === true) {
        printLog("info", "Completed seeding data. Restarting server...");

        process.kill(JSON.parse(await fsPromise.readFile("server-info.json", "utf8")).mainPID, "SIGTERM");
      } else {
        printLog("info", "Completed seeding data!");
      }
    } catch (error) {
      printLog("error", `Failed to seed data: ${error}. Exited!`);
    }
  }
}
