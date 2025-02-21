"use strict";

import { printLog } from "./logger.js";
import {
  cleanUpPostgreSQLTiles,
  cleanUpMBTilesTiles,
  cleanUpXYZTiles,
  readCleanUpFile,
  cleanUpGeoJSON,
  cleanUpStyle,
} from "./cleanup.js";
import {
  seedPostgreSQLTiles,
  seedMBTilesTiles,
  readSeedFile,
  seedXYZTiles,
  seedGeoJSON,
  seedStyle,
} from "./seed.js";

/**
 * Run clean up and seed tasks
 * @param {object} opts Options
 * @returns {Promise<void>}
 */
export async function runTasks(opts) {
  if (
    opts.cleanUpStyles === true ||
    opts.cleanUpGeoJSONs === true ||
    opts.cleanUpDatas === true ||
    opts.seedStyles === true ||
    opts.seedGeoJSONs === true ||
    opts.seedDatas === true
  ) {
    /* Read cleanup.json and seed.json files */
    printLog(
      "info",
      `Loading "seed.json" and "cleanup.json" files at "${process.env.DATA_DIR}"...`
    );

    const [cleanUpData, seedData] = await Promise.all([
      readCleanUpFile(true),
      readSeedFile(true),
    ]);

    /* Clean up styles */
    if (opts.cleanUpStyles === true) {
      try {
        if (cleanUpData.styles === undefined) {
          printLog("info", "No styles in cleanup. Skipping...");
        } else {
          const ids = Object.keys(cleanUpData.styles);

          printLog("info", `Starting clean up ${ids.length} styles...`);

          const startTime = Date.now();

          for (const id of ids) {
            const cleanUpStyleItem = cleanUpData.styles[id];

            if (cleanUpStyleItem.skip === true) {
              printLog("info", `Skipping clean up style "${id}"...`);

              continue;
            }

            try {
              await cleanUpStyle(
                id,
                cleanUpStyleItem.refreshBefore?.time ||
                  cleanUpStyleItem.refreshBefore?.day
              );
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
            `Completed clean up ${ids.length} styles after: ${
              (doneTime - startTime) / 1000
            }s!`
          );
        }
      } catch (error) {
        printLog("error", `Failed to clean up styles: ${error}. Exited!`);
      }
    }

    /* Clean up geojsons */
    if (opts.cleanUpGeoJSONs === true) {
      try {
        if (cleanUpData.geojsons === undefined) {
          printLog("info", "No geojsons in cleanup. Skipping...");
        } else {
          const ids = Object.keys(cleanUpData.geojsons);

          printLog("info", `Starting clean up ${ids.length} geojsons...`);

          const startTime = Date.now();

          for (const id of ids) {
            const cleanUpGeoJSONItem = cleanUpData.geojsons[id];

            if (cleanUpGeoJSONItem.skip === true) {
              printLog("info", `Skipping clean up geojson "${id}"...`);

              continue;
            }

            try {
              await cleanUpGeoJSON(
                id,
                cleanUpGeoJSONItem.refreshBefore?.time ||
                  cleanUpGeoJSONItem.refreshBefore?.day
              );
            } catch (error) {
              printLog(
                "error",
                `Failed to clean up geojson "${id}": ${error}. Skipping...`
              );
            }
          }

          const doneTime = Date.now();

          printLog(
            "info",
            `Completed clean up ${ids.length} geojsons after: ${
              (doneTime - startTime) / 1000
            }s!`
          );
        }
      } catch (error) {
        printLog("error", `Failed to clean up geojsons: ${error}. Exited!`);
      }
    }

    /* Clean up datas */
    if (opts.cleanUpDatas === true) {
      try {
        if (cleanUpData.datas === undefined) {
          printLog("info", "No datas in cleanup. Skipping...");
        } else {
          const ids = Object.keys(cleanUpData.datas);

          printLog("info", `Starting clean up ${ids.length} datas...`);

          const startTime = Date.now();

          for (const id of ids) {
            const seedDataItem = seedData.datas[id];
            const cleanUpDataItem = cleanUpData.datas[id];

            if (cleanUpDataItem.skip === true) {
              printLog("info", `Skipping clean up data "${id}"...`);

              continue;
            }

            try {
              if (seedDataItem.storeType === "xyz") {
                await cleanUpXYZTiles(
                  id,
                  seedDataItem.metadata.format,
                  cleanUpDataItem.zooms,
                  cleanUpDataItem.bboxs,
                  cleanUpDataItem.cleanUpBefore?.time ||
                    cleanUpDataItem.cleanUpBefore?.day
                );
              } else if (seedDataItem.storeType === "mbtiles") {
                await cleanUpMBTilesTiles(
                  id,
                  cleanUpDataItem.zooms,
                  cleanUpDataItem.bboxs,
                  cleanUpDataItem.cleanUpBefore?.time ||
                    cleanUpDataItem.cleanUpBefore?.day
                );
              } else if (seedDataItem.storeType === "pg") {
                await cleanUpPostgreSQLTiles(
                  id,
                  cleanUpDataItem.zooms,
                  cleanUpDataItem.bboxs,
                  cleanUpDataItem.cleanUpBefore?.time ||
                    cleanUpDataItem.cleanUpBefore?.day
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
            `Completed clean up ${ids.length} datas after: ${
              (doneTime - startTime) / 1000
            }s!`
          );
        }
      } catch (error) {
        printLog("error", `Failed to clean up datas: ${error}. Exited!`);
      }
    }

    /* Run seed styles */
    if (opts.seedStyles === true) {
      try {
        if (seedData.styles === undefined) {
          printLog("info", "No styles in seed. Skipping...");
        } else {
          const ids = Object.keys(seedData.styles);

          printLog("info", `Starting seed ${ids.length} styles...`);

          const startTime = Date.now();

          for (const id of ids) {
            const seedStyleItem = seedData.styles[id];

            if (seedStyleItem.skip === true) {
              printLog("info", `Skipping seed style "${id}"...`);

              continue;
            }

            try {
              await seedStyle(
                id,
                seedStyleItem.url,
                seedStyleItem.maxTry,
                seedStyleItem.timeout,
                seedStyleItem.refreshBefore?.time ||
                  seedStyleItem.refreshBefore?.day ||
                  seedStyleItem.refreshBefore?.md5
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
            `Completed seed ${ids.length} styles after: ${
              (doneTime - startTime) / 1000
            }s!`
          );
        }
      } catch (error) {
        printLog("error", `Failed to seed styles: ${error}. Exited!`);
      }
    }

    /* Run seed geojsons */
    if (opts.seedGeoJSONs === true) {
      try {
        if (seedData.geojsons === undefined) {
          printLog("info", "No geojsons in seed. Skipping...");
        } else {
          const ids = Object.keys(seedData.geojsons);

          printLog("info", `Starting seed ${ids.length} geojsons...`);

          const startTime = Date.now();

          for (const id of ids) {
            const seedGeoJSONItem = seedData.geojsons[id];

            if (seedGeoJSONItem.skip === true) {
              printLog("info", `Skipping seed geojson "${id}"...`);

              continue;
            }

            try {
              await seedGeoJSON(
                id,
                seedGeoJSONItem.url,
                seedGeoJSONItem.maxTry,
                seedGeoJSONItem.timeout,
                seedGeoJSONItem.refreshBefore?.time ||
                  seedGeoJSONItem.refreshBefore?.day ||
                  seedGeoJSONItem.refreshBefore?.md5
              );
            } catch (error) {
              printLog(
                "error",
                `Failed to seed geojson "${id}": ${error}. Skipping...`
              );
            }
          }

          const doneTime = Date.now();

          printLog(
            "info",
            `Completed seed ${ids.length} geojsons after: ${
              (doneTime - startTime) / 1000
            }s!`
          );
        }
      } catch (error) {
        printLog("error", `Failed to seed geojsons: ${error}. Exited!`);
      }
    }

    /* Run seed datas */
    if (opts.seedDatas === true) {
      try {
        if (seedData.datas === undefined) {
          printLog("info", "No datas in seed. Skipping...");
        } else {
          const ids = Object.keys(seedData.datas);

          printLog("info", `Starting seed ${ids.length} datas...`);

          const startTime = Date.now();

          for (const id of ids) {
            const seedDataItem = seedData.datas[id];

            if (seedDataItem.skip === true) {
              printLog("info", `Skipping seed data "${id}"...`);

              continue;
            }

            try {
              if (seedDataItem.storeType === "xyz") {
                await seedXYZTiles(
                  id,
                  seedDataItem.metadata,
                  seedDataItem.url,
                  seedDataItem.scheme,
                  seedDataItem.bboxs,
                  seedDataItem.zooms,
                  seedDataItem.concurrency,
                  seedDataItem.maxTry,
                  seedDataItem.timeout,
                  seedDataItem.storeMD5,
                  seedDataItem.storeTransparent,
                  seedDataItem.refreshBefore?.time ||
                    seedDataItem.refreshBefore?.day ||
                    seedDataItem.refreshBefore?.md5
                );
              } else if (seedDataItem.storeType === "mbtiles") {
                await seedMBTilesTiles(
                  id,
                  seedDataItem.metadata,
                  seedDataItem.url,
                  seedDataItem.scheme,
                  seedDataItem.bboxs,
                  seedDataItem.zooms,
                  seedDataItem.concurrency,
                  seedDataItem.maxTry,
                  seedDataItem.timeout,
                  seedDataItem.storeMD5,
                  seedDataItem.storeTransparent,
                  seedDataItem.refreshBefore?.time ||
                    seedDataItem.refreshBefore?.day ||
                    seedDataItem.refreshBefore?.md5
                );
              } else if (seedDataItem.storeType === "pg") {
                await seedPostgreSQLTiles(
                  id,
                  seedDataItem.metadata,
                  seedDataItem.url,
                  seedDataItem.scheme,
                  seedDataItem.bboxs,
                  seedDataItem.zooms,
                  seedDataItem.concurrency,
                  seedDataItem.maxTry,
                  seedDataItem.timeout,
                  seedDataItem.storeMD5,
                  seedDataItem.storeTransparent,
                  seedDataItem.refreshBefore?.time ||
                    seedDataItem.refreshBefore?.day ||
                    seedDataItem.refreshBefore?.md5
                );
              }
            } catch (error) {
              printLog(
                "error",
                `Failed to seed data "${id}": ${error}. Skipping...`
              );
            }
          }

          const doneTime = Date.now();

          printLog(
            "info",
            `Completed seed ${ids.length} datas after: ${
              (doneTime - startTime) / 1000
            }s!`
          );
        }
      } catch (error) {
        printLog("error", `Failed to seed datas: ${error}. Exited!`);
      }
    }
  } else {
    printLog("info", "No task assigned!");
  }
}
