"use strict";

import fsPromise from "node:fs/promises";
import { printLog } from "./logger.js";
import pLimit from "p-limit";
import os from "os";
import {
  updateXYZMetadataFileWithLock,
  updateXYZMD5FileWithLock,
  downloadXYZTileDataFile,
  removeXYZTileDataFile,
} from "./xyz.js";
import {
  getTileBoundsFromBBox,
  removeEmptyFolders,
  getDataBuffer,
} from "./utils.js";

/**
 * Download all xyz tile data files in a specified bounding box and zoom levels
 * @param {string} name Source data name
 * @param {string} description Source description
 * @param {string} tileURL Tile URL to download
 * @param {string} outputFolder Folder to store downloaded tiles
 * @param {"jpeg"|"jpg"|"pbf"|"png"|"webp"|"gif"} format Tile format
 * @param {Array<number>} bounds Bounding box in format [lonMin, latMin, lonMax, latMax] in EPSG:4326
 * @param {Array<number>} center Center in format [lon, lat, zoom] in EPSG:4326
 * @param {Array<number>} zooms Array of specific zoom levels
 * @param {Array<object>} vector_layers Vector layers
 * @param {object} tilestats Tile stats
 * @param {number} concurrency Concurrency download
 * @param {number} maxTry Number of retry attempts on failure
 * @param {number} timeout Timeout in milliseconds
 * @param {string|number|boolean} refreshBefore Date string in format "YYYY-MM-DDTHH:mm:ss" or number of days before which files should be refreshed
 * @returns {Promise<void>}
 */
export async function seedXYZTileDataFiles(
  name = "Unknown",
  description = "Unknown",
  tileURL,
  outputFolder,
  format = "png",
  bounds = [-180, -85.051129, 180, 85.051129],
  center = [0, 0, 11],
  zooms = [
    0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20,
    21, 22,
  ],
  vector_layers,
  tilestats,
  concurrency = os.cpus().length,
  maxTry = 5,
  timeout = 60000,
  refreshBefore
) {
  let refreshTimestamp;
  let log = `Downloading tile data files with:\n\tZoom levels [${zooms.join(
    ", "
  )}]\n\tBBox [${bounds.join(", ")}]`;

  if (typeof refreshBefore === "string") {
    refreshTimestamp = new Date(refreshBefore).getTime();

    log += `\n\tBefore ${refreshBefore}`;
  } else if (typeof refreshBefore === "number") {
    const now = new Date();

    refreshTimestamp = now.setDate(now.getDate() - refreshBefore);

    log += `\n\tOld than ${refreshBefore} days`;
  } else if (typeof refreshBefore === "boolean") {
    refreshTimestamp = true;

    log += `\n\tBefore check MD5`;
  }

  printLog("info", log);

  // Download file
  const tilesSummary = getTileBoundsFromBBox(bounds, zooms, "xyz");
  const limitConcurrencyDownload = pLimit(concurrency);
  const tilePromises = [];
  const hashs = {};

  for (const z in tilesSummary) {
    for (let x = tilesSummary[z].x[0]; x <= tilesSummary[z].x[1]; x++) {
      for (let y = tilesSummary[z].y[0]; y <= tilesSummary[z].y[1]; y++) {
        tilePromises.push(
          limitConcurrencyDownload(async () => {
            const tileName = `${z}/${x}/${y}`;
            const filePath = `${outputFolder}/${tileName}.${format}`;
            const url = tileURL.replaceAll("{z}/{x}/{y}", tileName);

            try {
              const stats = await fsPromise.stat(filePath);

              if (refreshTimestamp !== undefined) {
                if (refreshTimestamp === true) {
                  // Check md5
                  const md5URL = tileURL.replaceAll(
                    "{z}/{x}/{y}",
                    `md5/${tileName}`
                  );

                  const response = await getDataBuffer(md5URL, timeout);

                  if (response.headers["Etag"] !== hashs[tileName]) {
                    await downloadXYZTileDataFile(
                      url,
                      outputFolder,
                      tileName,
                      format,
                      maxTry,
                      timeout,
                      hashs
                    );
                  }
                } else if (
                  stats.ctimeMs === undefined ||
                  stats.ctimeMs < refreshTimestamp
                ) {
                  // Check timestamp
                  await downloadXYZTileDataFile(
                    url,
                    outputFolder,
                    tileName,
                    format,
                    maxTry,
                    timeout,
                    hashs
                  );
                }
              }
            } catch (error) {
              if (error.code === "ENOENT") {
                await downloadXYZTileDataFile(
                  url,
                  outputFolder,
                  tileName,
                  format,
                  maxTry,
                  timeout,
                  hashs
                );
              } else {
                printLog(
                  "error",
                  `Failed to seed tile data file "${tileName}": ${error}`
                );
              }
            }
          })
        );
      }
    }
  }

  await Promise.all(tilePromises);

  // Update metadata.json file
  const metadataFilePath = `${outputFolder}/metadata.json`;

  await updateXYZMetadataFileWithLock(
    metadataFilePath,
    {
      name: name,
      description: description,
      version: "1.0.0",
      format: format,
      bounds: bounds,
      center: center,
      type: "overlay",
      minzoom: minzoom,
      maxzoom: maxzoom,
      vector_layers: vector_layers,
      tilestats: tilestats,
    },
    300000 // 5 mins
  );

  // Update md5.json file
  const md5FilePath = `${outputFolder}/md5.json`;

  await updateXYZMD5FileWithLock(
    md5FilePath,
    hashs,
    300000 // 5 mins
  );

  // Remove folders if empty
  await removeEmptyFolders(outputFolder);
}

/**
 * Remove all xyz tile data files in a specified zoom levels
 * @param {string} outputFolder Folder to store downloaded tiles
 * @param {"jpeg"|"jpg"|"pbf"|"png"|"webp"|"gif"} format Tile format
 * @param {Array<number>} zooms Array of specific zoom levels
 * @param {Array<number>} bounds Bounding box in format [lonMin, latMin, lonMax, latMax] in EPSG:4326
 * @param {number} concurrency Concurrency download
 * @param {number} maxTry Number of retry attempts on failure
 * @param {string|number} cleanUpBefore Date string in format "YYYY-MM-DDTHH:mm:ss" or number of days before which files should be deleted
 * @returns {Promise<void>}
 */
export async function cleanXYZTileDataFiles(
  outputFolder,
  format = "png",
  zooms = [
    0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20,
    21, 22,
  ],
  bounds = [-180, -85.051129, 180, 85.051129],
  concurrency = os.cpus().length,
  maxTry = 5,
  cleanUpBefore
) {
  let cleanUpTimestamp;
  let log = `Removing tile data files with:\n\tZoom levels [${zooms.join(
    ", "
  )}]\n\tBBox [${bounds.join(", ")}]`;

  if (typeof cleanUpBefore === "string") {
    cleanUpTimestamp = new Date(cleanUpBefore).getTime();

    log += `\n\tBefore ${cleanUpBefore}`;
  } else if (typeof cleanUpBefore === "number") {
    const now = new Date();

    cleanUpTimestamp = now.setDate(now.getDate() - cleanUpBefore);

    log += `\n\tOld than ${cleanUpBefore} days`;
  }

  printLog("info", log);

  // Remove files
  const tilesSummary = getTileBoundsFromBBox(bounds, zooms, "xyz");
  const limitConcurrencyDownload = pLimit(concurrency);
  const tilePromises = [];
  const hashs = {};

  for (const z in tilesSummary) {
    for (let x = tilesSummary[z].x[0]; x <= tilesSummary[z].x[1]; x++) {
      for (let y = tilesSummary[z].y[0]; y <= tilesSummary[z].y[1]; y++) {
        tilePromises.push(
          limitConcurrencyDownload(async () => {
            const tileName = `${z}/${x}/${y}`;
            const filePath = `${outputFolder}/${tileName}.${format}`;

            try {
              const stats = await fsPromise.stat(filePath);

              // Check timestamp
              if (cleanUpTimestamp !== undefined) {
                if (
                  stats.ctimeMs === undefined ||
                  stats.ctimeMs < cleanUpTimestamp
                ) {
                  await removeXYZTileDataFile(
                    outputFolder,
                    tileName,
                    format,
                    maxTry,
                    300000, // 5 mins
                    hashs
                  );
                }
              }
            } catch (error) {
              if (error.code !== "ENOENT") {
                await removeXYZTileDataFile(
                  outputFolder,
                  tileName,
                  format,
                  maxTry,
                  300000, // 5 mins
                  hashs
                );
              } else {
                printLog(
                  "error",
                  `Failed to clean up tile data file "${tileName}": ${error}`
                );
              }
            }
          })
        );
      }
    }
  }

  await Promise.all(tilePromises);

  // Update md5.json file
  const md5FilePath = `${outputFolder}/md5.json`;

  await updateXYZMD5FileWithLock(
    md5FilePath,
    hashs,
    300000 // 5 mins
  );

  // Remove parent folder if empty
  await removeEmptyFolders(outputFolder);
}
