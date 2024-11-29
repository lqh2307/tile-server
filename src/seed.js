"use strict";

import { downloadStyleFile, getStyleCreated } from "./style.js";
import fsPromise from "node:fs/promises";
import { printLog } from "./logger.js";
import { Mutex } from "async-mutex";
import sqlite3 from "sqlite3";
import path from "node:path";
import os from "os";
import {
  updateXYZMetadataFileWithLock,
  downloadXYZTileDataFile,
  getXYZTileCreated,
  closeXYZMD5DB,
  getXYZTileMD5,
  openXYZMD5DB,
} from "./xyz.js";
import {
  updateMBTilesMetadataWithLock,
  getMBTilesTileCreated,
  downloadMBTilesTile,
  getMBTilesTileMD5,
  closeMBTilesDB,
  openMBTilesDB,
} from "./mbtiles.js";
import {
  getTilesBoundsFromBBoxs,
  removeEmptyFolders,
  getDataFromURL,
  validateJSON,
  delay,
} from "./utils.js";

/**
 * Read seed.json file
 * @param {boolean} isValidate Is validate file?
 * @returns {Promise<object>}
 */
export async function readSeedFile(isValidate) {
  /* Read seed.json file */
  const data = await fsPromise.readFile(
    `${process.env.DATA_DIR}/seed.json`,
    "utf8"
  );

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
        additionalProperties: false,
      },
      seed
    );
  }

  return seed;
}

/**
 * Seed MBTiles tiles
 * @param {string} sourcePath MBTiles folder path
 * @param {object} metadata Metadata object
 * @param {string} tileURL Tile URL to download
 * @param {Array<Array<number>>} bboxs Array of bounding box in format [[lonMin, latMin, lonMax, latMax]] in EPSG:4326
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
  bboxs = [[-180, -85.051129, 180, 85.051129]],
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
  const startTime = Date.now();

  const id = path.basename(sourcePath);
  const { total, tilesSummaries } = getTilesBoundsFromBBoxs(
    bboxs,
    zooms,
    "xyz"
  );
  let refreshTimestamp;
  let log = `Seeding ${total} tiles of mbtiles data "${id}" with:\n\tStore MD5: ${storeMD5}\n\tStore transparent: ${storeTransparent}\n\tConcurrency: ${concurrency}\n\tMax tries: ${maxTry}\n\tTimeout: ${timeout}\n\tZoom levels: [${zooms.join(
    ", "
  )}]\n\tBBoxs: [${bboxs.map((bbox) => `[${bbox.join(", ")}]`).join(", ")}]`;

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

  // Open MBTiles SQLite database
  const mbtilesSource = await openMBTilesDB(
    `${sourcePath}/${path.basename(sourcePath)}.mbtiles`,
    sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE,
    false
  );

  // Update metadata
  printLog("info", `Updating metadata...`);

  await updateMBTilesMetadataWithLock(
    mbtilesSource,
    metadata,
    300000 // 5 mins
  );

  // Download tiles
  const mutex = new Mutex();

  let activeTasks = 0;
  let remainingTasks = total;

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
          (async () => {
            const tileName = `${z}/${x}/${y}`;
            let needDownload = false;

            try {
              if (refreshTimestamp === true) {
                try {
                  const [response, md5] = await Promise.all([
                    getDataFromURL(
                      tileURL.replaceAll("{z}/{x}/{y}", `md5/${tileName}`),
                      timeout,
                      "arraybuffer"
                    ),
                    getMBTilesTileMD5(mbtilesSource, z, x, y),
                  ]);

                  if (response.headers["Etag"] !== md5) {
                    needDownload = true;
                  }
                } catch (error) {
                  if (error.message === "Tile MD5 does not exist") {
                    needDownload = true;
                  } else {
                    throw error;
                  }
                }
              } else if (refreshTimestamp !== undefined) {
                try {
                  const created = await getMBTilesTileCreated(
                    mbtilesSource,
                    z,
                    x,
                    y
                  );

                  if (!created || created < refreshTimestamp) {
                    needDownload = true;
                  }
                } catch (error) {
                  if (error.message === "Tile created does not exist") {
                    needDownload = true;
                  } else {
                    throw error;
                  }
                }
              } else {
                needDownload = true;
              }

              if (needDownload === true) {
                await downloadMBTilesTile(
                  tileURL.replaceAll("{z}/{x}/{y}", tileName),
                  mbtilesSource,
                  z,
                  x,
                  y,
                  maxTry,
                  timeout,
                  storeMD5,
                  storeTransparent
                );
              }
            } catch (error) {
              printLog(
                "error",
                `Failed to seed tile data "${tileName}": ${error}`
              );
            } finally {
              await mutex.runExclusive(() => {
                activeTasks--;
              });
            }
          })();
        }
      }
    }
  }

  /* Wait all tasks done */
  while (activeTasks > 0) {
    await delay(50);
  }

  // Close MBTiles SQLite database
  if (mbtilesSource !== undefined) {
    await closeMBTilesDB(mbtilesSource);
  }

  const doneTime = Date.now();

  printLog(
    "info",
    `Completed seed ${total} tiles of mbtiles data "${id}" after ${
      (doneTime - startTime) / 1000
    }s!`
  );
}

/**
 * Seed XYZ tiles
 * @param {string} sourcePath XYZ folder path
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
  bboxs = [[-180, -85.051129, 180, 85.051129]],
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
  const startTime = Date.now();

  const id = path.basename(sourcePath);
  const { total, tilesSummaries } = getTilesBoundsFromBBoxs(
    bboxs,
    zooms,
    "xyz"
  );
  let refreshTimestamp;
  let log = `Seeding ${total} tiles of xyz data "${id}" with:\n\tStore MD5: ${storeMD5}\n\tStore transparent: ${storeTransparent}\n\tConcurrency: ${concurrency}\n\tMax tries: ${maxTry}\n\tTimeout: ${timeout}\n\tZoom levels: [${zooms.join(
    ", "
  )}]\n\tBBoxs: [${bboxs.map((bbox) => `[${bbox.join(", ")}]`).join(", ")}]`;

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

  // Open MD5 SQLite database
  const xyzSource = await openXYZMD5DB(
    sourcePath,
    sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE,
    false
  );

  // Update metadata.json file
  const metadataFilePath = `${sourcePath}/metadata.json`;

  printLog("info", `Updating metadata...`);

  await updateXYZMetadataFileWithLock(
    metadataFilePath,
    metadata,
    300000 // 5 mins
  );

  // Download tile files
  const mutex = new Mutex();

  let activeTasks = 0;
  let remainingTasks = total;

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
          (async () => {
            const tileName = `${z}/${x}/${y}`;
            let needDownload = false;

            try {
              if (refreshTimestamp === true) {
                try {
                  const [response, md5] = await Promise.all([
                    getDataFromURL(
                      tileURL.replaceAll("{z}/{x}/{y}", `md5/${tileName}`),
                      timeout,
                      "arraybuffer"
                    ),
                    getXYZTileMD5(xyzSource, z, x, y),
                  ]);

                  if (response.headers["Etag"] !== md5) {
                    needDownload = true;
                  }
                } catch (error) {
                  if (error.message === "Tile MD5 does not exist") {
                    needDownload = true;
                  } else {
                    throw error;
                  }
                }
              } else if (refreshTimestamp !== undefined) {
                try {
                  const created = await getXYZTileCreated(
                    `${sourcePath}/${tileName}.${metadata.format}`
                  );

                  if (!created || created < refreshTimestamp) {
                    needDownload = true;
                  }
                } catch (error) {
                  if (error.message === "Tile created does not exist") {
                    needDownload = true;
                  } else {
                    throw error;
                  }
                }
              } else {
                needDownload = true;
              }

              if (needDownload === true) {
                await downloadXYZTileDataFile(
                  tileURL.replaceAll("{z}/{x}/{y}", tileName),
                  sourcePath,
                  xyzSource,
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
              printLog(
                "error",
                `Failed to seed tile data "${tileName}": ${error}`
              );
            } finally {
              await mutex.runExclusive(() => {
                activeTasks--;
              });
            }
          })();
        }
      }
    }
  }

  /* Wait all tasks done */
  while (activeTasks > 0) {
    await delay(50);
  }

  // Close MD5 SQLite database
  if (xyzSource !== undefined) {
    await closeXYZMD5DB(xyzSource);
  }

  // Remove parent folders if empty
  await removeEmptyFolders(
    sourcePath,
    /^.*\.(sqlite|json|gif|png|jpg|jpeg|webp|pbf)$/
  );

  const doneTime = Date.now();

  printLog(
    "info",
    `Completed seed ${total} tiles of xyz data "${id}" after ${
      (doneTime - startTime) / 1000
    }s!`
  );
}

/**
 * Seed style
 * @param {string} sourcePath Style folder path
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
  const startTime = Date.now();

  const id = path.basename(sourcePath);
  let refreshTimestamp;
  let log = `Seeding style "${id}" with:\n\tMax tries: ${maxTry}\n\tTimeout: ${timeout}`;

  if (typeof refreshBefore === "string") {
    refreshTimestamp = new Date(refreshBefore).getTime();

    log += `\n\tRefresh before: ${refreshBefore}`;
  } else if (typeof refreshBefore === "number") {
    const now = new Date();

    refreshTimestamp = now.setDate(now.getDate() - refreshBefore);

    log += `\n\tOld than: ${refreshBefore} days`;
  }

  printLog("info", log);

  // Download style.json file
  const filePath = `${sourcePath}/style.json`;

  try {
    if (refreshTimestamp !== undefined) {
      try {
        const created = await getStyleCreated(filePath);

        if (!created || created < refreshTimestamp) {
          needDownload = true;
        }
      } catch (error) {
        if (error.message === "Style created does not exist") {
          needDownload = true;
        } else {
          throw error;
        }
      }
    } else {
      needDownload = true;
    }

    if (needDownload === true) {
      await downloadStyleFile(styleURL, filePath, maxTry, timeout);
    }
  } catch (error) {
    printLog("error", `Failed to seed style "${id}": ${error}`);
  }

  // Remove parent folders if empty
  await removeEmptyFolders(sourcePath, /^.*\.json$/);

  const doneTime = Date.now();

  printLog(
    "info",
    `Completed seeding style "${id}" after ${(doneTime - startTime) / 1000}s!`
  );
}
