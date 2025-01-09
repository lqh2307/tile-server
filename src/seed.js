"use strict";

import { downloadStyleFile, getStyleCreated, getStyle } from "./style.js";
import fsPromise from "node:fs/promises";
import { printLog } from "./logger.js";
import { Mutex } from "async-mutex";
import sqlite3 from "sqlite3";
import os from "os";
import {
  downloadGeoJSONFile,
  getGeoJSONCreated,
  getGeoJSON,
} from "./geojson.js";
import {
  updateXYZMetadataFile,
  downloadXYZTileFile,
  getXYZTileCreated,
  closeXYZMD5DB,
  getXYZTileMD5,
  openXYZMD5DB,
} from "./tile_xyz.js";
import {
  updateMBTilesMetadata,
  getMBTilesTileCreated,
  downloadMBTilesTile,
  getMBTilesTileMD5,
  closeMBTilesDB,
  openMBTilesDB,
} from "./tile_mbtiles.js";
import {
  getTilesBoundsFromBBoxs,
  removeEmptyFolders,
  getDataFromURL,
  validateJSON,
  delay,
} from "./utils.js";
import {
  updatePostgreSQLMetadata,
  getPostgreSQLTileCreated,
  downloadPostgreSQLTile,
  getPostgreSQLTileMD5,
  closePostgreSQLDB,
  openPostgreSQLDB,
} from "./tile_postgresql.js";

let seed;

/**
 * Read seed.json file
 * @param {boolean} isValidate Is validate file?
 * @returns {Promise<object>}
 */
async function readSeedFile(isValidate) {
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
                },
                url: {
                  type: "string",
                  minLength: 1,
                },
                skip: {
                  type: "boolean",
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
              required: ["metadata", "url"],
            },
          },
          geojsons: {
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
                  },
                },
                url: {
                  type: "string",
                  minLength: 1,
                },
                skip: {
                  type: "boolean",
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
              required: ["metadata", "url"],
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
                      },
                      minItems: 0,
                    },
                    tilestats: {
                      type: "object",
                      properties: {
                        layerCount: {
                          type: "integer",
                        },
                      },
                    },
                  },
                  required: ["format"],
                },
                url: {
                  type: "string",
                  minLength: 1,
                },
                skip: {
                  type: "boolean",
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
                  minItems: 1,
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
                  enum: ["xyz", "mbtiles", "pg"],
                },
                storeMD5: {
                  type: "boolean",
                },
                storeTransparent: {
                  type: "boolean",
                },
              },
              required: ["metadata", "storeType", "url"],
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
                },
                timeout: {
                  type: "integer",
                  minimum: 0,
                },
                maxTry: {
                  type: "integer",
                  minimum: 1,
                },
                skip: {
                  type: "boolean",
                },
              },
              required: ["url"],
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
                },
                timeout: {
                  type: "integer",
                  minimum: 0,
                },
                maxTry: {
                  type: "integer",
                  minimum: 1,
                },
                skip: {
                  type: "boolean",
                },
              },
              required: ["url"],
            },
          },
        },
        required: ["styles", "geojsons", "datas", "sprites", "fonts"],
        additionalProperties: false,
      },
      seed
    );
  }

  return seed;
}

/**
 * Seed MBTiles tiles
 * @param {string} id Cache MBTiles ID
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
async function seedMBTilesTiles(
  id,
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

  const { total, tilesSummaries } = getTilesBoundsFromBBoxs(
    bboxs,
    zooms,
    "xyz"
  );

  let log = `Seeding ${total} tiles of mbtiles "${id}" with:\n\tStore MD5: ${storeMD5}\n\tStore transparent: ${storeTransparent}\n\tConcurrency: ${concurrency}\n\tMax try: ${maxTry}\n\tTimeout: ${timeout}\n\tZoom levels: [${zooms.join(
    ", "
  )}]\n\tBBoxs: [${bboxs.map((bbox) => `[${bbox.join(", ")}]`).join(", ")}]`;

  let refreshTimestamp;
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

  /* Open MBTiles SQLite database */
  const source = await openMBTilesDB(
    `${process.env.DATA_DIR}/caches/mbtiles/${id}/${id}.mbtiles`,
    sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE,
    false
  );

  /* Update metadata */
  printLog("info", "Updating metadata...");

  await updateMBTilesMetadata(
    source,
    metadata,
    300000 // 5 mins
  );

  /* Download tiles */
  const mutex = new Mutex();

  let activeTasks = 0;
  let remainingTasks = total;

  async function seedMBTilesTileData(z, x, y) {
    const tileName = `${z}/${x}/${y}`;

    try {
      let needDownload = false;

      if (refreshTimestamp === true) {
        try {
          const [response, md5] = await Promise.all([
            getDataFromURL(
              tileURL.replaceAll("{z}/{x}/{y}", `md5/${tileName}`),
              timeout,
              "arraybuffer"
            ),
            getMBTilesTileMD5(source, z, x, y),
          ]);

          if (response.headers["etag"] !== md5) {
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
          const created = await getMBTilesTileCreated(source, z, x, y);

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
        const targetURL = tileURL.replaceAll("{z}/{x}/{y}", tileName);

        printLog(
          "info",
          `Downloading data "${id}" - Tile "${tileName}" from "${targetURL}"...`
        );

        await downloadMBTilesTile(
          targetURL,
          source,
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
        `Failed to seed data "${id}" - Tile "${tileName}": ${error}`
      );
    }
  }

  printLog("info", "Downloading datas...");

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
          seedMBTilesTileData(z, x, y).finally(() =>
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

  // Close MBTiles SQLite database
  if (source !== undefined) {
    await closeMBTilesDB(source);
  }

  const doneTime = Date.now();

  printLog(
    "info",
    `Completed seed ${total} tiles of mbtiles "${id}" after ${
      (doneTime - startTime) / 1000
    }s!`
  );
}

/**
 * Seed PostgreSQL tiles
 * @param {string} id Cache PostgreSQL ID
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
async function seedPostgreSQLTiles(
  id,
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

  const { total, tilesSummaries } = getTilesBoundsFromBBoxs(
    bboxs,
    zooms,
    "xyz"
  );
  let log = `Seeding ${total} tiles of postgresql "${id}" with:\n\tStore MD5: ${storeMD5}\n\tStore transparent: ${storeTransparent}\n\tConcurrency: ${concurrency}\n\tMax try: ${maxTry}\n\tTimeout: ${timeout}\n\tZoom levels: [${zooms.join(
    ", "
  )}]\n\tBBoxs: [${bboxs.map((bbox) => `[${bbox.join(", ")}]`).join(", ")}]`;

  let refreshTimestamp;
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

  /* Open PostgreSQL database */
  const source = await openPostgreSQLDB(
    `${process.env.POSTGRESQL_BASE_URI}/${id}`,
    true
  );

  /* Update metadata */
  printLog("info", "Updating metadata...");

  await updatePostgreSQLMetadata(
    source,
    metadata,
    300000 // 5 mins
  );

  /* Download tiles */
  const mutex = new Mutex();

  let activeTasks = 0;
  let remainingTasks = total;

  async function seedPostgreSQLTileData(z, x, y) {
    const tileName = `${z}/${x}/${y}`;

    try {
      let needDownload = false;

      if (refreshTimestamp === true) {
        try {
          const [response, md5] = await Promise.all([
            getDataFromURL(
              tileURL.replaceAll("{z}/{x}/{y}", `md5/${tileName}`),
              timeout,
              "arraybuffer"
            ),
            getPostgreSQLTileMD5(source, z, x, y),
          ]);

          if (response.headers["etag"] !== md5) {
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
          const created = await getPostgreSQLTileCreated(source, z, x, y);

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
        const targetURL = tileURL.replaceAll("{z}/{x}/{y}", tileName);

        printLog(
          "info",
          `Downloading data "${id}" - Tile "${tileName}" from "${targetURL}"...`
        );

        await downloadPostgreSQLTile(
          targetURL,
          source,
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
        `Failed to seed data "${id}" - Tile "${tileName}": ${error}`
      );
    }
  }

  printLog("info", "Downloading datas...");

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
          seedPostgreSQLTileData(z, x, y).finally(() =>
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
    `Completed seed ${total} tiles of postgresql "${id}" after ${
      (doneTime - startTime) / 1000
    }s!`
  );
}

/**
 * Seed XYZ tiles
 * @param {string} id Cache XYZ ID
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
async function seedXYZTiles(
  id,
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

  const { total, tilesSummaries } = getTilesBoundsFromBBoxs(
    bboxs,
    zooms,
    "xyz"
  );

  let log = `Seeding ${total} tiles of xyz "${id}" with:\n\tStore MD5: ${storeMD5}\n\tStore transparent: ${storeTransparent}\n\tConcurrency: ${concurrency}\n\tMax try: ${maxTry}\n\tTimeout: ${timeout}\n\tZoom levels: [${zooms.join(
    ", "
  )}]\n\tBBoxs: [${bboxs.map((bbox) => `[${bbox.join(", ")}]`).join(", ")}]`;

  let refreshTimestamp;
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

  /* Open MD5 SQLite database */
  const source = await openXYZMD5DB(
    `${process.env.DATA_DIR}/caches/xyzs/${id}/${id}.sqlite`,
    sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE,
    false
  );

  /* Update metadata */
  printLog("info", "Updating metadata...");

  await updateXYZMetadataFile(
    `${process.env.DATA_DIR}/caches/xyzs/${id}/metadata.json`,
    metadata,
    300000 // 5 mins
  );

  /* Download tile files */
  const mutex = new Mutex();

  let activeTasks = 0;
  let remainingTasks = total;

  async function seedXYZTileData(z, x, y) {
    const tileName = `${z}/${x}/${y}`;

    try {
      let needDownload = false;

      if (refreshTimestamp === true) {
        try {
          const [response, md5] = await Promise.all([
            getDataFromURL(
              tileURL.replaceAll("{z}/{x}/{y}", `md5/${tileName}`),
              timeout,
              "arraybuffer"
            ),
            getXYZTileMD5(source, z, x, y),
          ]);

          if (response.headers["etag"] !== md5) {
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
            `${process.env.DATA_DIR}/caches/xyzs/${id}/${tileName}.${metadata.format}`
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
        const targetURL = tileURL.replaceAll("{z}/{x}/{y}", tileName);

        printLog(
          "info",
          `Downloading data "${id}" - Tile "${tileName}" from "${targetURL}"...`
        );

        await downloadXYZTileFile(
          targetURL,
          id,
          source,
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
        `Failed to seed data "${id}" - Tile "${tileName}": ${error}`
      );
    }
  }

  printLog("info", "Downloading datas...");

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
          seedXYZTileData(z, x, y).finally(() =>
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

  /* Close MD5 SQLite database */
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
    `Completed seed ${total} tiles of xyz "${id}" after ${
      (doneTime - startTime) / 1000
    }s!`
  );
}

/**
 * Seed geojson
 * @param {string} id Cache geojson ID
 * @param {string} geojsonURL GeoJSON URL
 * @param {number} maxTry Number of retry attempts on failure
 * @param {number} timeout Timeout in milliseconds
 * @param {string|number} refreshBefore Date string in format "YYYY-MM-DDTHH:mm:ss" or number of days before which file should be refreshed
 * @returns {Promise<void>}
 */
async function seedGeoJSON(
  id,
  geojsonURL,
  maxTry = 5,
  timeout = 60000,
  refreshBefore
) {
  const startTime = Date.now();

  let log = `Seeding geojson "${id}" with:\n\tMax try: ${maxTry}\n\tTimeout: ${timeout}`;

  let refreshTimestamp;
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

  /* Download geojson.geojson file */
  const filePath = `${process.env.DATA_DIR}/caches/geojsons/${id}/geojson.geojson`;

  try {
    let needDownload = false;

    if (refreshTimestamp === true) {
      try {
        const [response, geoJSON] = await Promise.all([
          getDataFromURL(
            geojsonURL.replaceAll("geojson.geojson", `md5/geojson.geojson`),
            timeout,
            "arraybuffer"
          ),
          getGeoJSON(filePath),
        ]);

        if (
          response.headers["etag"] !==
          calculateMD5(Buffer.from(JSON.stringify(geoJSON), "utf8"))
        ) {
          needDownload = true;
        }
      } catch (error) {
        if (error.message === "GeoJSON does not exist") {
          needDownload = true;
        } else {
          throw error;
        }
      }
    } else if (refreshTimestamp !== undefined) {
      try {
        const created = await getGeoJSONCreated(filePath);

        if (!created || created < refreshTimestamp) {
          needDownload = true;
        }
      } catch (error) {
        if (error.message === "GeoJSON created does not exist") {
          needDownload = true;
        } else {
          throw error;
        }
      }
    } else {
      needDownload = true;
    }

    printLog("info", "Downloading geojson...");

    if (needDownload === true) {
      printLog(
        "info",
        `Downloading geojson "${id}" - File "${filePath}" from "${geojsonURL}"...`
      );

      await downloadGeoJSONFile(geojsonURL, filePath, maxTry, timeout);
    }
  } catch (error) {
    printLog("error", `Failed to seed geojson "${id}": ${error}`);
  }

  /* Remove parent folders if empty */
  await removeEmptyFolders(
    `${process.env.DATA_DIR}/caches/geojsons/${id}`,
    /^.*\.geojson$/
  );

  const doneTime = Date.now();

  printLog(
    "info",
    `Completed seeding geojson "${id}" after ${(doneTime - startTime) / 1000}s!`
  );
}

/**
 * Seed style
 * @param {string} id Cache style ID
 * @param {string} styleURL Style URL
 * @param {number} maxTry Number of retry attempts on failure
 * @param {number} timeout Timeout in milliseconds
 * @param {string|number} refreshBefore Date string in format "YYYY-MM-DDTHH:mm:ss" or number of days before which file should be refreshed
 * @returns {Promise<void>}
 */
async function seedStyle(
  id,
  styleURL,
  maxTry = 5,
  timeout = 60000,
  refreshBefore
) {
  const startTime = Date.now();

  let log = `Seeding style "${id}" with:\n\tMax try: ${maxTry}\n\tTimeout: ${timeout}`;

  let refreshTimestamp;
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

  /* Download style.json file */
  const filePath = `${process.env.DATA_DIR}/caches/styles/${id}/style.json`;

  try {
    let needDownload = false;

    if (refreshTimestamp === true) {
      try {
        const [response, styleJSON] = await Promise.all([
          getDataFromURL(
            styleURL.replaceAll("style.json", `md5/style.json`),
            timeout,
            "arraybuffer"
          ),
          getStyle(filePath),
        ]);

        if (
          response.headers["etag"] !==
          calculateMD5(Buffer.from(JSON.stringify(styleJSON), "utf8"))
        ) {
          needDownload = true;
        }
      } catch (error) {
        if (error.message === "Style does not exist") {
          needDownload = true;
        } else {
          throw error;
        }
      }
    } else if (refreshTimestamp !== undefined) {
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

    printLog("info", "Downloading style...");

    if (needDownload === true) {
      printLog(
        "info",
        `Downloading style "${id}" - File "${filePath}" from "${styleURL}"...`
      );

      await downloadStyleFile(styleURL, filePath, maxTry, timeout);
    }
  } catch (error) {
    printLog("error", `Failed to seed style "${id}": ${error}`);
  }

  /* Remove parent folders if empty */
  await removeEmptyFolders(
    `${process.env.DATA_DIR}/caches/styles/${id}`,
    /^.*\.json$/
  );

  const doneTime = Date.now();

  printLog(
    "info",
    `Completed seeding style "${id}" after ${(doneTime - startTime) / 1000}s!`
  );
}

/**
 * Load seed.json file
 * @returns {Promise<void>}
 */
async function loadSeedFile() {
  seed = await readSeedFile(true);
}

export {
  seedPostgreSQLTiles,
  seedMBTilesTiles,
  readSeedFile,
  seedXYZTiles,
  loadSeedFile,
  seedGeoJSON,
  seedStyle,
  seed,
};
