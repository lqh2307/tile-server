"use strict";

import { checkReadyMiddleware } from "./middleware.js";
import { StatusCodes } from "http-status-codes";
import { printLog } from "./logger.js";
import { config } from "./config.js";
import { seed } from "./seed.js";
import sqlite3 from "sqlite3";
import express from "express";
import {
  getXYZTileFromURL,
  cacheXYZTileFile,
  getXYZTileMD5,
  openXYZMD5DB,
  validateXYZ,
  getXYZInfos,
  getXYZTile,
} from "./tile_xyz.js";
import {
  getMBTilesTileFromURL,
  cacheMBtilesTileData,
  downloadMBTilesFile,
  getMBTilesTileMD5,
  validateMBTiles,
  getMBTilesInfos,
  getMBTilesTile,
  openMBTilesDB,
} from "./tile_mbtiles.js";
import {
  createDataMetadata,
  getRequestHost,
  calculateMD5,
  isExistFile,
  gzipAsync,
} from "./utils.js";
import {
  validatePMTiles,
  getPMTilesInfos,
  getPMTilesTile,
  openPMTiles,
} from "./tile_pmtiles.js";
import {
  getPostgreSQLTileFromURL,
  cachePostgreSQLTileData,
  getPostgreSQLTileMD5,
  getPostgreSQLInfos,
  validatePostgreSQL,
  getPostgreSQLTile,
  openPostgreSQLDB,
} from "./tile_postgresql.js";

/**
 * Get data tile handler
 * @returns {(req: any, res: any, next: any) => Promise<any>}
 */
function getDataTileHandler() {
  return async (req, res, next) => {
    const id = req.params.id;
    const item = config.repo.datas[id];

    /* Check data is exist? */
    if (item === undefined) {
      return res.status(StatusCodes.NOT_FOUND).send("Data does not exist");
    }

    /* Check data tile format */
    if (req.params.format !== item.tileJSON.format) {
      return res
        .status(StatusCodes.BAD_REQUEST)
        .send("Data tile format is invalid");
    }

    /* Get tile name */
    const z = Number(req.params.z);
    const x = Number(req.params.x);
    const y = Number(req.params.y);
    const tileName = `${z}/${x}/${y}`;

    /* Get tile data */
    let dataTile;

    try {
      if (item.sourceType === "mbtiles") {
        try {
          dataTile = await getMBTilesTile(item.source, z, x, y);
        } catch (error) {
          if (
            item.sourceURL !== undefined &&
            error.message === "Tile does not exist"
          ) {
            const url = item.sourceURL.replaceAll("{z}/{x}/{y}", tileName);

            printLog(
              "info",
              `Forwarding data "${id}" - Tile "${tileName}" - To "${url}"...`
            );

            /* Get data */
            dataTile = await getMBTilesTileFromURL(
              url,
              60000 // 1 mins
            );

            /* Cache */
            if (item.storeCache === true) {
              printLog("info", `Caching data "${id}" - Tile "${tileName}"...`);

              cacheMBtilesTileData(
                item.source,
                z,
                x,
                y,
                dataTile.data,
                item.storeMD5,
                item.storeTransparent
              ).catch((error) =>
                printLog(
                  "error",
                  `Failed to cache data "${id}" - Tile "${tileName}": ${error}`
                )
              );
            }
          } else {
            throw error;
          }
        }
      } else if (item.sourceType === "pmtiles") {
        dataTile = await getPMTilesTile(item.source, z, x, y);
      } else if (item.sourceType === "xyz") {
        try {
          dataTile = await getXYZTile(
            item.source,
            z,
            x,
            y,
            item.tileJSON.format
          );
        } catch (error) {
          if (
            item.sourceURL !== undefined &&
            error.message === "Tile does not exist"
          ) {
            const url = item.sourceURL.replaceAll("{z}/{x}/{y}", tileName);

            printLog(
              "info",
              `Forwarding data "${id}" - Tile "${tileName}" - To "${url}"...`
            );

            /* Get data */
            dataTile = await getXYZTileFromURL(
              url,
              60000 // 1 mins
            );

            /* Cache */
            if (item.storeCache === true) {
              printLog("info", `Caching data "${id}" - Tile "${tileName}"...`);

              cacheXYZTileFile(
                item.source,
                item.md5Source,
                z,
                x,
                y,
                item.tileJSON.format,
                dataTile.data,
                item.storeMD5,
                item.storeTransparent
              ).catch((error) =>
                printLog(
                  "error",
                  `Failed to cache data "${id}" - Tile "${tileName}": ${error}`
                )
              );
            }
          } else {
            throw error;
          }
        }
      } else if (item.sourceType === "pg") {
        try {
          dataTile = await getPostgreSQLTile(item.source, z, x, y);
        } catch (error) {
          if (
            item.sourceURL !== undefined &&
            error.message === "Tile does not exist"
          ) {
            const url = item.sourceURL.replaceAll("{z}/{x}/{y}", tileName);

            printLog(
              "info",
              `Forwarding data "${id}" - Tile "${tileName}" - To "${url}"...`
            );

            /* Get data */
            dataTile = await getPostgreSQLTileFromURL(
              url,
              60000 // 1 mins
            );

            /* Cache */
            if (item.storeCache === true) {
              printLog("info", `Caching data "${id}" - Tile "${tileName}"...`);

              cachePostgreSQLTileData(
                item.source,
                z,
                x,
                y,
                dataTile.data,
                item.storeMD5,
                item.storeTransparent
              ).catch((error) =>
                printLog(
                  "error",
                  `Failed to cache data "${id}" - Tile "${tileName}": ${error}`
                )
              );
            }
          } else {
            throw error;
          }
        }
      }

      /* Gzip pbf data tile */
      if (
        dataTile.headers["content-type"] === "application/x-protobuf" &&
        dataTile.headers["content-encoding"] === undefined
      ) {
        dataTile.data = await gzipAsync(dataTile.data);

        dataTile.headers["content-encoding"] = "gzip";
      }

      res.set(dataTile.headers);

      return res.status(StatusCodes.OK).send(dataTile.data);
    } catch (error) {
      printLog(
        "error",
        `Failed to get data "${id}" - Tile "${tileName}": ${error}`
      );

      if (error.message === "Tile does not exist") {
        return res.status(StatusCodes.NO_CONTENT).send(error.message);
      } else {
        return res
          .status(StatusCodes.INTERNAL_SERVER_ERROR)
          .send("Internal server error");
      }
    }
  };
}

/**
 * Get data tileJSON handler
 * @returns {(req: any, res: any, next: any) => Promise<any>}
 */
function getDataHandler() {
  return async (req, res, next) => {
    const id = req.params.id;
    const item = config.repo.datas[id];

    if (item === undefined) {
      return res.status(StatusCodes.NOT_FOUND).send("Data does not exist");
    }

    try {
      res.header("content-type", "application/json");

      return res.status(StatusCodes.OK).send({
        ...item.tileJSON,
        tilejson: "2.2.0",
        scheme: "xyz",
        id: id,
        tiles: [
          `${getRequestHost(req)}/datas/${id}/{z}/{x}/{y}.${
            item.tileJSON.format
          }`,
        ],
      });
    } catch (error) {
      printLog("error", `Failed to get data "${id}": ${error}`);

      return res
        .status(StatusCodes.INTERNAL_SERVER_ERROR)
        .send("Internal server error");
    }
  };
}

/**
 * Get data tile MD5 handler
 * @returns {(req: any, res: any, next: any) => Promise<any>}
 */
function getDataTileMD5Handler() {
  return async (req, res, next) => {
    const id = req.params.id;
    const item = config.repo.datas[id];

    /* Check data is exist? */
    if (item === undefined) {
      return res.status(StatusCodes.NOT_FOUND).send("Data does not exist");
    }

    /* Check data tile format */
    if (req.params.format !== item.tileJSON.format) {
      return res
        .status(StatusCodes.BAD_REQUEST)
        .send("Data tile format is invalid");
    }

    /* Get tile name */
    const z = Number(req.params.z);
    const x = Number(req.params.x);
    const y = Number(req.params.y);
    const tileName = `${z}/${x}/${y}`;

    /* Get tile data MD5 */
    let md5;

    try {
      if (item.sourceType === "mbtiles") {
        if (item.storeMD5 === true) {
          md5 = await getMBTilesTileMD5(item.source, z, x, y);
        } else {
          const tile = await getMBTilesTile(item.source, z, x, y);

          md5 = calculateMD5(tile.data);
        }
      } else if (item.sourceType === "pmtiles") {
        const tile = await getPMTilesTile(item.source, z, x, y);

        md5 = calculateMD5(tile.data);
      } else if (item.sourceType === "xyz") {
        if (item.storeMD5 === true) {
          md5 = await getXYZTileMD5(item.md5Source, z, x, y);
        } else {
          const tile = await getXYZTile(
            item.source,
            z,
            x,
            y,
            item.tileJSON.format
          );

          md5 = calculateMD5(tile.data);
        }
      } else if (item.sourceType === "pg") {
        if (item.storeMD5 === true) {
          md5 = await getPostgreSQLTileMD5(item.source, z, x, y);
        } else {
          const tile = await getPostgreSQLTile(item.source, z, x, y);

          md5 = calculateMD5(tile.data);
        }
      }

      /* Add MD5 to header */
      res.set({
        etag: md5,
      });

      return res.status(StatusCodes.OK).send();
    } catch (error) {
      printLog(
        "error",
        `Failed to get md5 data "${id}" - Tile "${tileName}": ${error}`
      );

      if (
        error.message === "Tile MD5 does not exist" ||
        error.message === "Tile does not exist"
      ) {
        return res.status(StatusCodes.NO_CONTENT).send(error.message);
      } else {
        return res
          .status(StatusCodes.INTERNAL_SERVER_ERROR)
          .send("Internal server error");
      }
    }
  };
}

/**
 * Get data tile list handler
 * @returns {(req: any, res: any, next: any) => Promise<any>}
 */
function getDatasListHandler() {
  return async (req, res, next) => {
    try {
      const requestHost = getRequestHost(req);

      const result = await Promise.all(
        Object.keys(config.repo.datas).map(async (id) => {
          return {
            id: id,
            name: config.repo.datas[id].tileJSON.name,
            url: `${requestHost}/datas/${id}.json`,
          };
        })
      );

      return res.status(StatusCodes.OK).send(result);
    } catch (error) {
      printLog("error", `Failed to get datas": ${error}`);

      return res
        .status(StatusCodes.INTERNAL_SERVER_ERROR)
        .send("Internal server error");
    }
  };
}

/**
 * Get data tileJSON list handler
 * @returns {(req: any, res: any, next: any) => Promise<any>}
 */
function getDataTileJSONsListHandler() {
  return async (req, res, next) => {
    try {
      const requestHost = getRequestHost(req);

      const result = await Promise.all(
        Object.keys(config.repo.datas).map(async (id) => {
          const item = config.repo.datas[id];

          return {
            ...item.tileJSON,
            tilejson: "2.2.0",
            scheme: "xyz",
            id: id,
            tiles: [
              `${requestHost}/datas/${id}/{z}/{x}/{y}.${item.tileJSON.format}`,
            ],
          };
        })
      );

      return res.status(StatusCodes.OK).send(result);
    } catch (error) {
      printLog("error", `Failed to get data tileJSONs": ${error}`);

      return res
        .status(StatusCodes.INTERNAL_SERVER_ERROR)
        .send("Internal server error");
    }
  };
}

export const serve_data = {
  init: () => {
    const app = express().disable("x-powered-by");

    /**
     * @swagger
     * tags:
     *   - name: Data
     *     description: Data related endpoints
     * /datas/datas.json:
     *   get:
     *     tags:
     *       - Data
     *     summary: Get all datas
     *     responses:
     *       200:
     *         description: List of all datas
     *         content:
     *           application/json:
     *             schema:
     *               type: array
     *               items:
     *                 type: object
     *                 properties:
     *                   id:
     *                     type: string
     *                   name:
     *                     type: string
     *                   url:
     *                     type: string
     *       404:
     *         description: Not found
     *       503:
     *         description: Server is starting up
     *         content:
     *           text/plain:
     *             schema:
     *               type: string
     *               example: Starting...
     *       500:
     *         description: Internal server error
     */
    app.get("/datas.json", checkReadyMiddleware(), getDatasListHandler());

    /**
     * @swagger
     * tags:
     *   - name: Data
     *     description: Data related endpoints
     * /datas/tilejsons.json:
     *   get:
     *     tags:
     *       - Data
     *     summary: Get all data tileJSONs
     *     responses:
     *       200:
     *         description: List of all data tileJSONs
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *       404:
     *         description: Not found
     *       503:
     *         description: Server is starting up
     *         content:
     *           text/plain:
     *             schema:
     *               type: string
     *               example: Starting...
     *       500:
     *         description: Internal server error
     */
    app.get(
      "/tilejsons.json",
      checkReadyMiddleware(),
      getDataTileJSONsListHandler()
    );

    /**
     * @swagger
     * tags:
     *   - name: Data
     *     description: Data related endpoints
     * /datas/{id}.json:
     *   get:
     *     tags:
     *       - Data
     *     summary: Get data by ID
     *     parameters:
     *       - in: path
     *         name: id
     *         required: true
     *         schema:
     *           type: string
     *           example: id
     *         description: Data ID
     *     responses:
     *       200:
     *         description: Data information
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *       400:
     *         description: Invalid params
     *       404:
     *         description: Not found
     *       503:
     *         description: Server is starting up
     *         content:
     *           text/plain:
     *             schema:
     *               type: string
     *               example: Starting...
     *       500:
     *         description: Internal server error
     */
    app.get("/:id.json", checkReadyMiddleware(), getDataHandler());

    /**
     * @swagger
     * tags:
     *   - name: Data
     *     description: Data related endpoints
     * /datas/{id}/{z}/{x}/{y}.{format}:
     *   get:
     *     tags:
     *       - Data
     *     summary: Get data tile
     *     parameters:
     *       - in: path
     *         name: id
     *         required: true
     *         schema:
     *           type: string
     *           example: id
     *         description: Data ID
     *       - in: path
     *         name: z
     *         required: true
     *         schema:
     *           type: integer
     *           example: 0
     *         description: Zoom level
     *       - in: path
     *         name: x
     *         required: true
     *         schema:
     *           type: integer
     *           example: 0
     *         description: Tile X coordinate
     *       - in: path
     *         name: y
     *         required: true
     *         schema:
     *           type: integer
     *           example: 0
     *         description: Tile Y coordinate
     *       - in: path
     *         name: format
     *         required: true
     *         schema:
     *           type: string
     *           enum: [jpeg, jpg, pbf, png, webp, gif]
     *           example: png
     *         description: Tile format
     *     responses:
     *       200:
     *         description: Data tile
     *         content:
     *           application/octet-stream:
     *             schema:
     *               type: string
     *               format: binary
     *       204:
     *         description: No content
     *       404:
     *         description: Not found
     *       503:
     *         description: Server is starting up
     *         content:
     *           text/plain:
     *             schema:
     *               type: string
     *               example: Starting...
     *       500:
     *         description: Internal server error
     */
    app.get(
      `/:id/:z(\\d+)/:x(\\d+)/:y(\\d+).:format(jpeg|jpg|pbf|png|webp|gif)`,
      checkReadyMiddleware(),
      getDataTileHandler()
    );

    /**
     * @swagger
     * tags:
     *   - name: Data
     *     description: Data related endpoints
     * /datas/{id}/md5/{z}/{x}/{y}.{format}:
     *   get:
     *     tags:
     *       - Data
     *     summary: Get data tile MD5
     *     parameters:
     *       - in: path
     *         name: id
     *         required: true
     *         schema:
     *           type: string
     *           example: id
     *         description: Data ID
     *       - in: path
     *         name: z
     *         required: true
     *         schema:
     *           type: integer
     *           example: 0
     *         description: Zoom level
     *       - in: path
     *         name: x
     *         required: true
     *         schema:
     *           type: integer
     *           example: 0
     *         description: Tile X coordinate
     *       - in: path
     *         name: y
     *         required: true
     *         schema:
     *           type: integer
     *           example: 0
     *         description: Tile Y coordinate
     *       - in: path
     *         name: format
     *         required: true
     *         schema:
     *           type: string
     *           enum: [jpeg, jpg, pbf, png, webp, gif]
     *           example: png
     *         description: Tile format
     *     responses:
     *       200:
     *         description: Data tile MD5
     *         content:
     *           application/octet-stream:
     *             schema:
     *               type: string
     *               format: binary
     *       204:
     *         description: No content
     *       400:
     *         description: Invalid params
     *       404:
     *         description: Not found
     *       503:
     *         description: Server is starting up
     *         content:
     *           text/plain:
     *             schema:
     *               type: string
     *               example: Starting...
     *       500:
     *         description: Internal server error
     */
    app.get(
      `/:id/md5/:z(\\d+)/:x(\\d+)/:y(\\d+).:format(jpeg|jpg|pbf|png|webp|gif)`,
      checkReadyMiddleware(),
      getDataTileMD5Handler()
    );

    return app;
  },

  add: async () => {
    await Promise.all(
      Object.keys(config.datas).map(async (id) => {
        try {
          const item = config.datas[id];
          const dataInfo = {};

          /* Load data */
          if (item.mbtiles !== undefined) {
            dataInfo.sourceType = "mbtiles";

            if (
              item.mbtiles.startsWith("https://") === true ||
              item.mbtiles.startsWith("http://") === true
            ) {
              dataInfo.path = `${process.env.DATA_DIR}/mbtiles/${id}/${id}.mbtiles`;

              /* Download MBTiles file if not exist */
              if ((await isExistFile(dataInfo.path)) === false) {
                printLog(
                  "info",
                  `Downloading MBTiles file "${dataInfo.path}" from "${item.mbtiles}"...`
                );

                await downloadMBTilesFile(
                  item.mbtiles,
                  dataInfo.path,
                  5,
                  3600000 // 1 hour
                );
              }

              dataInfo.source = await openMBTilesDB(
                dataInfo.path,
                sqlite3.OPEN_READONLY,
                false
              );

              dataInfo.tileJSON = await getMBTilesInfos(dataInfo.source);
            } else {
              if (item.cache !== undefined) {
                dataInfo.path = `${process.env.DATA_DIR}/caches/mbtiles/${item.mbtiles}/${item.mbtiles}.mbtiles`;

                const cacheSource = seed.datas[item.mbtiles];

                if (
                  cacheSource === undefined ||
                  cacheSource.storeType !== "mbtiles"
                ) {
                  throw new Error(
                    `Cache mbtiles data "${item.mbtiles}" is invalid`
                  );
                }

                if (item.cache.forward === true) {
                  dataInfo.sourceURL = cacheSource.url;
                  dataInfo.storeCache = item.cache.store;
                  dataInfo.storeMD5 = cacheSource.storeMD5;
                  dataInfo.storeTransparent = cacheSource.storeTransparent;
                }

                /* Open MBTiles */
                if (
                  dataInfo.storeCache === true ||
                  (await isExistFile(dataInfo.path)) === false
                ) {
                  dataInfo.source = await openMBTilesDB(
                    dataInfo.path,
                    sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE,
                    false
                  );
                } else {
                  dataInfo.source = await openMBTilesDB(
                    dataInfo.path,
                    sqlite3.OPEN_READONLY,
                    false
                  );
                }

                /* Get MBTiles metadata */
                dataInfo.tileJSON = createDataMetadata({
                  ...cacheSource.metadata,
                  cacheBBoxs: cacheSource.cacheBBoxs,
                });
              } else {
                dataInfo.path = `${process.env.DATA_DIR}/mbtiles/${item.mbtiles}`;

                /* Open MBTiles */
                dataInfo.source = await openMBTilesDB(
                  dataInfo.path,
                  sqlite3.OPEN_READONLY,
                  false
                );

                /* Get MBTiles metadata */
                dataInfo.tileJSON = await getMBTilesInfos(dataInfo.source);
              }
            }

            /* Validate MBTiles */
            validateMBTiles(dataInfo.tileJSON);
          } else if (item.pmtiles !== undefined) {
            dataInfo.sourceType = "pmtiles";

            if (
              item.pmtiles.startsWith("https://") === true ||
              item.pmtiles.startsWith("http://") === true
            ) {
              dataInfo.path = item.pmtiles;

              /* Open PMTiles */
              dataInfo.source = openPMTiles(dataInfo.path);

              /* Get PMTiles metadata */
              dataInfo.tileJSON = await getPMTilesInfos(dataInfo.source);
            } else {
              dataInfo.path = `${process.env.DATA_DIR}/pmtiles/${item.pmtiles}`;

              /* Open PMTiles */
              dataInfo.source = openPMTiles(dataInfo.path);

              /* Get PMTiles metadata */
              dataInfo.tileJSON = await getPMTilesInfos(dataInfo.source);
            }

            validatePMTiles(dataInfo.tileJSON);
          } else if (item.xyz !== undefined) {
            dataInfo.sourceType = "xyz";

            if (item.cache !== undefined) {
              dataInfo.path = `${process.env.DATA_DIR}/caches/xyzs/${item.xyz}`;
              const md5FilePath = `${dataInfo.path}/${item.xyz}.sqlite`;

              const cacheSource = seed.datas[item.xyz];

              if (
                cacheSource === undefined ||
                cacheSource.storeType !== "xyz"
              ) {
                throw new Error(`Cache xyz data "${item.xyz}" is invalid`);
              }

              if (item.cache.forward === true) {
                dataInfo.sourceURL = cacheSource.url;
                dataInfo.storeCache = item.cache.store;
                dataInfo.storeMD5 = cacheSource.storeMD5;
                dataInfo.storeTransparent = cacheSource.storeTransparent;
              }

              if (
                dataInfo.storeCache === true ||
                (await isExistFile(md5FilePath)) === false
              ) {
                dataInfo.md5Source = await openXYZMD5DB(
                  md5FilePath,
                  sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE,
                  false
                );
              } else {
                dataInfo.md5Source = await openXYZMD5DB(
                  md5FilePath,
                  sqlite3.OPEN_READONLY,
                  false
                );
              }

              dataInfo.source = dataInfo.path;

              /* Get XYZ metadata */
              dataInfo.tileJSON = createDataMetadata({
                ...cacheSource.metadata,
                cacheBBoxs: cacheSource.cacheBBoxs,
              });
            } else {
              dataInfo.path = `${process.env.DATA_DIR}/xyzs/${item.xyz}`;

              dataInfo.source = dataInfo.path;

              /* Get XYZ metadata */
              dataInfo.tileJSON = await getXYZInfos(dataInfo.source);
            }

            validateXYZ(dataInfo.tileJSON);
          } else if (item.pg !== undefined) {
            dataInfo.sourceType = "pg";

            if (item.cache !== undefined) {
              dataInfo.path = `${process.env.POSTGRESQL_BASE_URI}/${id}`;

              const cacheSource = seed.datas[item.pg];

              if (cacheSource === undefined || cacheSource.storeType !== "pg") {
                throw new Error(`Cache pg data "${item.pg}" is invalid`);
              }

              if (item.cache.forward === true) {
                dataInfo.sourceURL = cacheSource.url;
                dataInfo.storeCache = item.cache.store;
                dataInfo.storeMD5 = cacheSource.storeMD5;
                dataInfo.storeTransparent = cacheSource.storeTransparent;
              }

              /* Open PostgreSQL */
              dataInfo.source = await openPostgreSQLDB(dataInfo.path, true);

              /* Get PostgreSQL metadata */
              dataInfo.tileJSON = createDataMetadata({
                ...cacheSource.metadata,
                cacheBBoxs: cacheSource.cacheBBoxs,
              });
            } else {
              dataInfo.path = `${process.env.POSTGRESQL_BASE_URI}/${id}`;

              /* Open PostgreSQL */
              dataInfo.source = await openPostgreSQLDB(dataInfo.path, true);

              /* Get PostgreSQL metadata */
              dataInfo.tileJSON = await getPostgreSQLInfos(dataInfo.source);
            }

            validatePostgreSQL(dataInfo.tileJSON);
          }

          /* Add to repo */
          config.repo.datas[id] = dataInfo;
        } catch (error) {
          printLog(
            "error",
            `Failed to load data "${id}": ${error}. Skipping...`
          );
        }
      })
    );
  },
};
