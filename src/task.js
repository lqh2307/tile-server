"use strict";

import { printLog } from "./logger.js";
import {
  cleanUpPostgreSQLTiles,
  cleanUpMBTilesTiles,
  cleanUpXYZTiles,
  readCleanUpFile,
  cleanUpGeoJSON,
  cleanUpSprite,
  cleanUpStyle,
  cleanUpFont,
} from "./cleanup.js";
import {
  seedPostgreSQLTiles,
  seedMBTilesTiles,
  readSeedFile,
  seedXYZTiles,
  seedGeoJSON,
  seedSprite,
  seedStyle,
  seedFont,
} from "./seed.js";
import os from "os";

/**
 * Run clean up and seed tasks
 * @param {object} opts Options
 * @returns {Promise<void>}
 */
export async function runTasks(opts) {
  if (
    opts.cleanUpSprites === true ||
    opts.cleanUpFonts === true ||
    opts.cleanUpStyles === true ||
    opts.cleanUpGeoJSONs === true ||
    opts.cleanUpDatas === true ||
    opts.seedSprites === true ||
    opts.seedFonts === true ||
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

    const defaultZooms = [
      0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20,
      21, 22,
    ];
    const defaultBBoxs = [[-180, -85.051129, 180, 85.051129]];
    const defaultTimeout = 60000;
    const defaultMaxTry = 5;
    const defaultConcurrency = os.cpus().length;
    const defaultStoreMD5 = false;
    const defaultStoreTransparent = false;

    /* Clean up sprites */
    if (opts.cleanUpSprites === true) {
      try {
        if (cleanUpData.sprites === undefined) {
          printLog("info", "No sprites in cleanup. Skipping...");
        } else {
          const ids = Object.keys(cleanUpData.sprites);

          printLog("info", `Starting clean up ${ids.length} sprites...`);

          const startTime = Date.now();

          for (const id of ids) {
            const cleanUpSpriteItem = cleanUpData.sprites[id];

            if (cleanUpSpriteItem.skip === true) {
              printLog("info", `Skipping clean up sprite "${id}"...`);

              continue;
            }

            try {
              await cleanUpSprite(
                id,
                cleanUpSpriteItem.refreshBefore?.time ||
                  cleanUpSpriteItem.refreshBefore?.day
              );
            } catch (error) {
              printLog(
                "error",
                `Failed to clean up sprite "${id}": ${error}. Skipping...`
              );
            }
          }

          const doneTime = Date.now();

          printLog(
            "info",
            `Completed clean up ${ids.length} sprites after: ${
              (doneTime - startTime) / 1000
            }s!`
          );
        }
      } catch (error) {
        printLog("error", `Failed to clean up sprites: ${error}. Exited!`);
      }
    }

    /* Clean up fonts */
    if (opts.cleanUpFonts === true) {
      try {
        if (cleanUpData.fonts === undefined) {
          printLog("info", "No fonts in cleanup. Skipping...");
        } else {
          const ids = Object.keys(cleanUpData.fonts);

          printLog("info", `Starting clean up ${ids.length} fonts...`);

          const startTime = Date.now();

          for (const id of ids) {
            const cleanUpFontItem = cleanUpData.fonts[id];

            if (cleanUpFontItem.skip === true) {
              printLog("info", `Skipping clean up font "${id}"...`);

              continue;
            }

            try {
              await cleanUpFont(
                id,
                cleanUpFontItem.refreshBefore?.time ||
                  cleanUpFontItem.refreshBefore?.day
              );
            } catch (error) {
              printLog(
                "error",
                `Failed to clean up font "${id}": ${error}. Skipping...`
              );
            }
          }

          const doneTime = Date.now();

          printLog(
            "info",
            `Completed clean up ${ids.length} fonts after: ${
              (doneTime - startTime) / 1000
            }s!`
          );
        }
      } catch (error) {
        printLog("error", `Failed to clean up fonts: ${error}. Exited!`);
      }
    }

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
                  cleanUpDataItem.zooms || defaultZooms,
                  cleanUpDataItem.bboxs || defaultBBoxs,
                  cleanUpDataItem.cleanUpBefore?.time ||
                    cleanUpDataItem.cleanUpBefore?.day
                );
              } else if (seedDataItem.storeType === "mbtiles") {
                await cleanUpMBTilesTiles(
                  id,
                  cleanUpDataItem.zooms || defaultZooms,
                  cleanUpDataItem.bboxs || defaultBBoxs,
                  cleanUpDataItem.cleanUpBefore?.time ||
                    cleanUpDataItem.cleanUpBefore?.day
                );
              } else if (seedDataItem.storeType === "pg") {
                await cleanUpPostgreSQLTiles(
                  id,
                  cleanUpDataItem.zooms || defaultZooms,
                  cleanUpDataItem.bboxs || defaultBBoxs,
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
                seedStyleItem.maxTry || defaultMaxTry,
                seedStyleItem.timeout || defaultTimeout,
                seedStyleItem.refreshBefore?.time ||
                  seedStyleItem.refreshBefore?.day
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
                seedGeoJSONItem.maxTry || defaultMaxTry,
                seedGeoJSONItem.timeout || defaultTimeout,
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
                  seedDataItem.zooms || defaultZooms,
                  seedDataItem.bboxs || defaultBBoxs,
                  seedDataItem.concurrency || defaultConcurrency,
                  seedDataItem.maxTry || defaultMaxTry,
                  seedDataItem.timeout || defaultTimeout,
                  seedDataItem.storeMD5 || defaultStoreMD5,
                  seedDataItem.storeTransparent || defaultStoreTransparent,
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
                  seedDataItem.zooms || defaultZooms,
                  seedDataItem.bboxs || defaultBBoxs,
                  seedDataItem.concurrency || defaultConcurrency,
                  seedDataItem.maxTry || defaultMaxTry,
                  seedDataItem.timeout || defaultTimeout,
                  seedDataItem.storeMD5 || defaultStoreMD5,
                  seedDataItem.storeTransparent || defaultStoreTransparent,
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
                  seedDataItem.zooms || defaultZooms,
                  seedDataItem.bboxs || defaultBBoxs,
                  seedDataItem.concurrency || defaultConcurrency,
                  seedDataItem.maxTry || defaultMaxTry,
                  seedDataItem.timeout || defaultTimeout,
                  seedDataItem.storeMD5 || defaultStoreMD5,
                  seedDataItem.storeTransparent || defaultStoreTransparent,
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
