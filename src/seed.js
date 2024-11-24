"use strict";

import { downloadStyleFile } from "./style.js";
import fsPromise from "node:fs/promises";
import { readSeedFile } from "./seed.js";
import { printLog } from "./logger.js";
import { Mutex } from "async-mutex";
import path from "node:path";
import os from "os";
import {
  updateXYZMetadataFileWithLock,
  downloadXYZTileDataFile,
  getXYZTileMD5,
} from "./xyz.js";
import {
  getTileBoundsFromBBox,
  removeEmptyFolders,
  getDataFromURL,
  validateJSON,
  delay,
} from "./utils.js";
import {
  updateMBTilesMetadataWithLock,
  downloadMBTilesTile,
  getMBTilesTileMD5,
  openMBTilesDB,
} from "./mbtiles.js";

/**
 * Read seed.json file
 * @param {string} dataDir The data directory
 * @param {boolean} isValidate Is validate file?
 * @returns {Promise<object>}
 */
export async function readSeedFile(dataDir, isValidate) {
  /* Read seed.json file */
  const data = await fsPromise.readFile(`${dataDir}/seed.json`, "utf8");

  const seed = JSON.parse(data);

  /* Validate seed.json file */
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
                metadata: {
                  type: "object",
                  properties: {
                    name: {
                      type: "string",
                    },
                    zoom: {
                      type: "integer",
                      minimum: 0,
                      maximum: 22,
                    },
                    center: {
                      type: "array",
                      items: {
                        type: "number",
                        minimum: -180,
                        maximum: 180,
                      },
                      minItems: 3,
                      maxItems: 3,
                    },
                  },
                  additionalProperties: true,
                },
                url: {
                  type: "string",
                  minLength: 1,
                },
                refreshBefore: {
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
                timeout: {
                  type: "integer",
                  minimum: 0,
                },
                maxTry: {
                  type: "integer",
                  minimum: 1,
                },
              },
              required: ["url"],
              additionalProperties: true,
            },
          },
          datas: {
            type: "object",
            additionalProperties: {
              type: "object",
              properties: {
                metadata: {
                  type: "object",
                  properties: {
                    name: {
                      type: "string",
                    },
                    description: {
                      type: "string",
                    },
                    attribution: {
                      type: "string",
                    },
                    version: {
                      type: "string",
                    },
                    type: {
                      type: "string",
                      enum: ["baselayer", "overlay"],
                    },
                    scheme: {
                      type: "string",
                      enum: ["tms", "xyz"],
                    },
                    format: {
                      type: "string",
                      enum: ["gif", "png", "jpg", "jpeg", "webp", "pbf"],
                    },
                    minzoom: {
                      type: "integer",
                      minimum: 0,
                      maximum: 22,
                    },
                    maxzoom: {
                      type: "integer",
                      minimum: 0,
                      maximum: 22,
                    },
                    bounds: {
                      type: "array",
                      items: {
                        type: "number",
                        minimum: -180,
                        maximum: 180,
                      },
                      minItems: 4,
                      maxItems: 4,
                    },
                    center: {
                      type: "array",
                      items: {
                        type: "number",
                        minimum: -180,
                        maximum: 180,
                      },
                      minItems: 3,
                      maxItems: 3,
                    },
                    vector_layers: {
                      type: "array",
                      items: {
                        type: "object",
                        properties: {
                          id: {
                            type: "string",
                          },
                          description: {
                            type: "string",
                          },
                          minzoom: {
                            type: "integer",
                            minimum: 0,
                            maximum: 22,
                          },
                          maxzoom: {
                            type: "integer",
                            minimum: 0,
                            maximum: 22,
                          },
                          fields: {
                            type: "object",
                            additionalProperties: {
                              type: "string",
                            },
                          },
                        },
                        required: ["id"],
                        additionalProperties: true,
                      },
                    },
                    tilestats: {
                      type: "object",
                      properties: {
                        layerCount: {
                          type: "integer",
                        },
                      },
                      additionalProperties: true,
                    },
                  },
                  required: ["format"],
                  additionalProperties: true,
                },
                url: {
                  type: "string",
                  minLength: 1,
                },
                refreshBefore: {
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
                    md5: {
                      type: "boolean",
                    },
                  },
                  anyOf: [
                    { required: ["time"] },
                    { required: ["day"] },
                    { required: ["md5"] },
                  ],
                  additionalProperties: true,
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
                timeout: {
                  type: "integer",
                  minimum: 0,
                },
                concurrency: {
                  type: "integer",
                  minimum: 1,
                },
                maxTry: {
                  type: "integer",
                  minimum: 1,
                },
                storeType: {
                  type: "string",
                  enum: ["xyz", "mbtiles"],
                },
                storeMD5: {
                  type: "boolean",
                },
                storeTransparent: {
                  type: "boolean",
                },
              },
              required: ["metadata", "storeType", "url"],
              additionalProperties: true,
            },
          },
          sprites: {
            type: "object",
            additionalProperties: {
              type: "object",
              properties: {
                url: {
                  type: "string",
                  minLength: 1,
                },
                refreshBefore: {
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
                timeout: {
                  type: "integer",
                  minimum: 0,
                },
                maxTry: {
                  type: "integer",
                  minimum: 1,
                },
              },
              required: ["url"],
              additionalProperties: true,
            },
          },
          fonts: {
            type: "object",
            additionalProperties: {
              type: "object",
              properties: {
                url: {
                  type: "string",
                  minLength: 1,
                },
                refreshBefore: {
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
                timeout: {
                  type: "integer",
                  minimum: 0,
                },
                maxTry: {
                  type: "integer",
                  minimum: 1,
                },
              },
              required: ["url"],
              additionalProperties: true,
            },
          },
        },
        required: ["styles", "datas", "sprites", "fonts"],
        additionalProperties: true,
      },
      seed
    );
  }

  return seed;
}

/**
 * Download all MBTiles tile data files in a specified bounding box and zoom levels
 * @param {string} sourcePath Folder path
 * @param {object} metadata Metadata object
 * @param {string} tileURL Tile URL to download
 * @param {Array<number>} bbox Bounding box in format [lonMin, latMin, lonMax, latMax] in EPSG:4326
 * @param {Array<number>} zooms Array of specific zoom levels
 * @param {number} concurrency Concurrency download
 * @param {number} maxTry Number of retry attempts on failure
 * @param {number} timeout Timeout in milliseconds
 * @param {boolean} storeMD5 Is store MD5 hashed?
 * @param {boolean} storeTransparent Is store transparent tile?
 * @param {string|number|boolean} refreshBefore Date string in format "YYYY-MM-DDTHH:mm:ss" or number of days before which files should be refreshed
 * @returns {Promise<void>}
 */
export async function seedMBTilesTiles(
  sourcePath,
  metadata,
  tileURL,
  bbox = [-180, -85.051129, 180, 85.051129],
  zooms = [
    0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20,
    21, 22,
  ],
  concurrency = os.cpus().length,
  maxTry = 5,
  timeout = 60000,
  storeMD5 = false,
  storeTransparent = false,
  refreshBefore
) {
  const tilesSummary = getTileBoundsFromBBox(bbox, zooms, "xyz");
  let totalTasks = Object.values(tilesSummary).reduce(
    (total, tile) =>
      total + (tile.x[1] - tile.x[0] + 1) * (tile.y[1] - tile.y[0] + 1),
    0
  );
  let refreshTimestamp;
  let log = `Seeding ${totalTasks} tiles of cache mbtiles data id ${path.basename(
    sourcePath
  )} with:\n\tConcurrency: ${concurrency}\n\tMax tries: ${maxTry}\n\tTimeout: ${timeout}\n\tZoom levels: [${zooms.join(
    ", "
  )}]\n\tBBox: [${bbox.join(", ")}]`;

  if (typeof refreshBefore === "string") {
    refreshTimestamp = new Date(refreshBefore).getTime();

    log += `\n\tRefresh before: ${refreshBefore}`;
  } else if (typeof refreshBefore === "number") {
    const now = new Date();

    refreshTimestamp = now.setDate(now.getDate() - refreshBefore);

    log += `\n\tOld than: ${refreshBefore} days`;
  } else if (typeof refreshBefore === "boolean") {
    refreshTimestamp = true;

    log += `\n\tRefresh before: check MD5`;
  }

  printLog("info", log);

  // Open MBTiles database
  const mbtilesSource = await openMBTilesDB(
    sourcePath,
    sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE,
    true
  );

  // Update metadata
  printLog("info", `Updating metadata to "${sourcePath}"...`);

  await updateMBTilesMetadataWithLock(
    mbtilesSource,
    metadata,
    300000 // 5 mins
  );

  // Download files
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
          const url = tileURL.replaceAll("{z}/{x}/{y}", tileName);

          try {
            if (refreshTimestamp !== undefined) {
              const stats = await fsPromise.stat(
                `${sourcePath}/${tileName}.${metadata.format}`
              );

              if (refreshTimestamp === true) {
                const md5URL = tileURL.replaceAll(
                  "{z}/{x}/{y}",
                  `md5/${tileName}`
                );

                const response = await getDataFromURL(md5URL, timeout);

                let oldMD5;

                try {
                  oldMD5 = await getMBTilesTileMD5(mbtilesSource, z, x, y);
                } catch (error) {
                  if (error.message === "Tile MD5 does not exist") {
                    await downloadMBTilesTile(
                      url,
                      mbtilesSource,
                      z,
                      x,
                      y,
                      metadata.format,
                      maxTry,
                      timeout,
                      storeMD5,
                      storeTransparent
                    );
                  }
                }

                if (response.headers["Etag"] !== oldMD5) {
                  await downloadMBTilesTile(
                    url,
                    mbtilesSource,
                    z,
                    x,
                    y,
                    metadata.format,
                    maxTry,
                    timeout,
                    storeMD5,
                    storeTransparent
                  );
                }
              } else if (
                stats.ctimeMs === undefined ||
                stats.ctimeMs < refreshTimestamp
              ) {
                await downloadMBTilesTile(
                  url,
                  mbtilesSource,
                  z,
                  x,
                  y,
                  metadata.format,
                  maxTry,
                  timeout,
                  storeMD5,
                  storeTransparent
                );
              }
            } else {
              await downloadMBTilesTile(
                url,
                mbtilesSource,
                z,
                x,
                y,
                metadata.format,
                maxTry,
                timeout,
                storeMD5,
                storeTransparent
              );
            }
          } catch (error) {
            if (error.code === "ENOENT") {
              await downloadXYZTileDataFile(
                url,
                sourcePath,
                z,
                x,
                y,
                metadata.format,
                maxTry,
                timeout,
                storeMD5,
                storeTransparent
              );
            } else {
              printLog(
                "error",
                `Failed to seed tile data "${tileName}": ${error}`
              );
            }
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
}

/**
 * Seed cache XYZ tiles
 * @param {string} sourcePath Folder path
 * @param {object} metadata Metadata object
 * @param {string} tileURL Tile URL
 * @param {Array<number>} bbox Bounding box in format [lonMin, latMin, lonMax, latMax] in EPSG:4326
 * @param {Array<number>} zooms Array of specific zoom levels
 * @param {number} concurrency Concurrency to download
 * @param {number} maxTry Number of retry attempts on failure
 * @param {number} timeout Timeout in milliseconds
 * @param {boolean} storeMD5 Is store MD5 hashed?
 * @param {boolean} storeTransparent Is store transparent tile?
 * @param {string|number|boolean} refreshBefore Date string in format "YYYY-MM-DDTHH:mm:ss" or number of days before which files should be refreshed
 * @returns {Promise<void>}
 */
export async function seedXYZTiles(
  sourcePath,
  metadata,
  tileURL,
  bbox = [-180, -85.051129, 180, 85.051129],
  zooms = [
    0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20,
    21, 22,
  ],
  concurrency = os.cpus().length,
  maxTry = 5,
  timeout = 60000,
  storeMD5 = false,
  storeTransparent = false,
  refreshBefore
) {
  const tilesSummary = getTileBoundsFromBBox(bbox, zooms, "xyz");
  let totalTasks = Object.values(tilesSummary).reduce(
    (total, tile) =>
      total + (tile.x[1] - tile.x[0] + 1) * (tile.y[1] - tile.y[0] + 1),
    0
  );
  let refreshTimestamp;
  let log = `Seeding ${totalTasks} tiles of cache xyz data id ${path.basename(
    sourcePath
  )} with:\n\tConcurrency: ${concurrency}\n\tMax tries: ${maxTry}\n\tTimeout: ${timeout}\n\tZoom levels: [${zooms.join(
    ", "
  )}]\n\tBBox: [${bbox.join(", ")}]`;

  if (typeof refreshBefore === "string") {
    refreshTimestamp = new Date(refreshBefore).getTime();

    log += `\n\tRefresh before: ${refreshBefore}`;
  } else if (typeof refreshBefore === "number") {
    const now = new Date();

    refreshTimestamp = now.setDate(now.getDate() - refreshBefore);

    log += `\n\tOld than: ${refreshBefore} days`;
  } else if (typeof refreshBefore === "boolean") {
    refreshTimestamp = true;

    log += `\n\tRefresh before: check MD5`;
  }

  printLog("info", log);

  // Update metadata.json file
  const metadataFilePath = `${sourcePath}/metadata.json`;

  printLog("info", `Updating metadata to "${metadataFilePath}"...`);

  await updateXYZMetadataFileWithLock(
    metadataFilePath,
    metadata,
    300000 // 5 mins
  );

  // Download files
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
          const url = tileURL.replaceAll("{z}/{x}/{y}", tileName);

          try {
            if (refreshTimestamp !== undefined) {
              const stats = await fsPromise.stat(
                `${sourcePath}/${tileName}.${metadata.format}`
              );

              if (refreshTimestamp === true) {
                const md5URL = tileURL.replaceAll(
                  "{z}/{x}/{y}",
                  `md5/${tileName}`
                );

                const response = await getDataFromURL(md5URL, timeout);

                let oldMD5;

                try {
                  oldMD5 = await getXYZTileMD5(sourcePath, z, x, y);
                } catch (error) {
                  if (error.message === "Tile MD5 does not exist") {
                    await downloadXYZTileDataFile(
                      url,
                      sourcePath,
                      z,
                      x,
                      y,
                      metadata.format,
                      maxTry,
                      timeout,
                      storeMD5,
                      storeTransparent
                    );
                  }
                }

                if (response.headers["Etag"] !== oldMD5) {
                  await downloadXYZTileDataFile(
                    url,
                    sourcePath,
                    z,
                    x,
                    y,
                    metadata.format,
                    maxTry,
                    timeout,
                    storeMD5,
                    storeTransparent
                  );
                }
              } else if (
                stats.ctimeMs === undefined ||
                stats.ctimeMs < refreshTimestamp
              ) {
                await downloadXYZTileDataFile(
                  url,
                  sourcePath,
                  z,
                  x,
                  y,
                  metadata.format,
                  maxTry,
                  timeout,
                  storeMD5,
                  storeTransparent
                );
              }
            } else {
              await downloadXYZTileDataFile(
                url,
                sourcePath,
                z,
                x,
                y,
                metadata.format,
                maxTry,
                timeout,
                storeMD5,
                storeTransparent
              );
            }
          } catch (error) {
            if (error.code === "ENOENT") {
              await downloadXYZTileDataFile(
                url,
                sourcePath,
                z,
                x,
                y,
                metadata.format,
                maxTry,
                timeout,
                storeMD5,
                storeTransparent
              );
            } else {
              printLog(
                "error",
                `Failed to seed tile data file "${tileName}": ${error}`
              );
            }
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

  // Remove parent folders if empty
  await removeEmptyFolders(
    sourcePath,
    /^.*\.(sqlite|json|gif|png|jpg|jpeg|webp|pbf)$/
  );
}

/**
 * Seed cache style
 * @param {string} sourcePath Folder path
 * @param {string} styleURL Style URL
 * @param {number} maxTry Number of retry attempts on failure
 * @param {number} timeout Timeout in milliseconds
 * @param {string|number} refreshBefore Date string in format "YYYY-MM-DDTHH:mm:ss" or number of days before which file should be refreshed
 * @returns {Promise<void>}
 */
export async function seedStyle(
  sourcePath,
  styleURL,
  maxTry = 5,
  timeout = 60000,
  refreshBefore
) {
  let refreshTimestamp;
  let log = `Seeding cache style id ${path.basename(
    sourcePath
  )} with:\n\tMax tries: ${maxTry}\n\tTimeout: ${timeout}`;

  if (typeof refreshBefore === "string") {
    refreshTimestamp = new Date(refreshBefore).getTime();

    log += `\n\tRefresh before: ${refreshBefore}`;
  } else if (typeof refreshBefore === "number") {
    const now = new Date();

    refreshTimestamp = now.setDate(now.getDate() - refreshBefore);

    log += `\n\tOld than: ${refreshBefore} days`;
  }

  printLog("info", log);

  // Download file
  const filePath = `${sourcePath}/style.json`;

  try {
    if (refreshTimestamp !== undefined) {
      const stats = await fsPromise.stat(filePath);

      // Check timestamp
      if (stats.ctimeMs === undefined || stats.ctimeMs < refreshTimestamp) {
        await downloadStyleFile(styleURL, filePath, maxTry, timeout);
      }
    } else {
      await downloadStyleFile(styleURL, filePath, maxTry, timeout);
    }
  } catch (error) {
    if (error.code === "ENOENT") {
      await downloadStyleFile(styleURL, filePath, maxTry, timeout);
    } else {
      printLog(
        "error",
        `Failed to seed cache style id ${path.basename(sourcePath)}: ${error}`
      );
    }
  }

  // Remove parent folders if empty
  await removeEmptyFolders(sourcePath, /^.*\.json$/);
}
