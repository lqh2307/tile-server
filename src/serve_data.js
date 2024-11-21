"use strict";

import { getMBTilesTileMD5, getPMTilesTileMD5, getXYZTileMD5 } from "./md5.js";
import { getPMTilesInfos, getPMTilesTile, openPMTiles } from "./pmtiles.js";
import { checkReadyMiddleware } from "./middleware.js";
import { StatusCodes } from "http-status-codes";
import { readSeedFile } from "./seed.js";
import { printLog } from "./logger.js";
import { config } from "./config.js";
import express from "express";
import {
  cacheXYZTileDataFile,
  getXYZTileFromURL,
  getXYZInfos,
  getXYZTile,
} from "./xyz.js";
import {
  downloadMBTilesFile,
  createMBTilesIndex,
  getMBTilesInfos,
  getMBTilesTile,
  openMBTiles,
} from "./mbtiles.js";
import {
  createMetadata,
  getRequestHost,
  isExistFile,
  gzipAsync,
} from "./utils.js";

/**
 * Validate data info (no validate json field)
 * @param {object} info Data info
 * @returns {void}
 */
function validateDataInfo(info) {
  /* Validate name */
  if (info.name === undefined) {
    throw new Error("Data name info is invalid");
  }

  /* Validate type */
  if (info.type !== undefined) {
    if (["baselayer", "overlay"].includes(info.type) === false) {
      throw new Error("Data type info is invalid");
    }
  }

  /* Validate format */
  if (
    ["jpeg", "jpg", "pbf", "png", "webp", "gif"].includes(info.format) === false
  ) {
    throw new Error("Data format info is invalid");
  }

  /* Validate json */
  /*
  if (info.format === "pbf" && info.json === undefined) {
    throw new Error(`Data json info is invalid`);
  }
  */

  /* Validate minzoom */
  if (info.minzoom < 0 || info.minzoom > 22) {
    throw new Error("Data minzoom info is invalid");
  }

  /* Validate maxzoom */
  if (info.maxzoom < 0 || info.maxzoom > 22) {
    throw new Error("Data maxzoom info is invalid");
  }

  /* Validate minzoom & maxzoom */
  if (info.minzoom > info.maxzoom) {
    throw new Error("Data zoom info is invalid");
  }

  /* Validate bounds */
  if (info.bounds !== undefined) {
    if (
      info.bounds.length !== 4 ||
      Math.abs(info.bounds[0]) > 180 ||
      Math.abs(info.bounds[2]) > 180 ||
      Math.abs(info.bounds[1]) > 90 ||
      Math.abs(info.bounds[3]) > 90 ||
      info.bounds[0] >= info.bounds[2] ||
      info.bounds[1] >= info.bounds[3]
    ) {
      throw new Error("Data bounds info is invalid");
    }
  }

  /* Validate center */
  if (info.center !== undefined) {
    if (
      info.center.length !== 3 ||
      Math.abs(info.center[0]) > 180 ||
      Math.abs(info.center[1]) > 90 ||
      info.center[2] < 0 ||
      info.center[2] > 22
    ) {
      throw new Error("Data center info is invalid");
    }
  }
}

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
      return res.status(StatusCodes.NOT_FOUND).send("Data is not found");
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

    try {
      /* Get tile data */
      let dataTile;

      if (item.sourceType === "mbtiles") {
        dataTile = await getMBTilesTile(
          item.source,
          z,
          x,
          req.query.scheme === "tms" ? y : (1 << z) - 1 - y // Default of MBTiles is tms. Flip Y to convert tms scheme => xyz scheme
        );
      } else if (item.sourceType === "pmtiles") {
        dataTile = await getPMTilesTile(
          item.source,
          z,
          x,
          req.query.scheme === "tms" ? (1 << z) - 1 - y : y // Default of PMTiles is xyz. Flip Y to convert xyz scheme => tms scheme
        );
      } else if (item.sourceType === "xyz") {
        try {
          dataTile = await getXYZTile(
            item.source,
            z,
            x,
            req.query.scheme === "tms" ? (1 << z) - 1 - y : y, // Default of XYZ is xyz. Flip Y to convert xyz scheme => tms scheme
            item.tileJSON.format
          );
        } catch (error) {
          if (
            error.message === "Tile does not exist" &&
            item.sourceURL !== undefined
          ) {
            const url = item.sourceURL.replaceAll("{z}/{x}/{y}", tileName);

            printLog(
              "info",
              `Getting data "${id}" - Tile "${tileName}" - From "${url}"...`
            );

            /* Get data */
            dataTile = await getXYZTileFromURL(
              url,
              60000 // 1 mins
            );

            /* Cache */
            if (item.storeCache === true) {
              cacheXYZTileDataFile(
                item.source,
                z,
                x,
                y,
                item.tileJSON.format,
                dataTile.data,
                dataTile.etag,
                item.storeMD5,
                item.storeTransparent
              ).catch((error) =>
                printLog(
                  "error",
                  `Failed to cache data "${id}" - Tile "${tileName}" - From "${url}": ${error}`
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
        dataTile.headers["Content-Type"] === "application/x-protobuf" &&
        dataTile.headers["Content-Encoding"] === undefined
      ) {
        dataTile.data = await gzipAsync(dataTile.data);

        dataTile.headers["Content-Encoding"] = "gzip";
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
      }

      return res
        .status(StatusCodes.INTERNAL_SERVER_ERROR)
        .send("Internal server error");
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
      return res.status(StatusCodes.NOT_FOUND).send("Data is not found");
    }

    try {
      res.header("Content-Type", "application/json");

      return res.status(StatusCodes.OK).send({
        ...item.tileJSON,
        tilejson: "2.2.0",
        tiles: [
          `${getRequestHost(req)}datas/${id}/{z}/{x}/{y}.${
            item.tileJSON.format
          }${req.query.scheme === "tms" ? "?scheme=tms" : ""}`,
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
      return res.status(StatusCodes.NOT_FOUND).send("Data is not found");
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

    try {
      /* Get tile data MD5 */
      let md5;

      if (item.sourceType === "mbtiles") {
        md5 = await getMBTilesTileMD5(
          item.source,
          z,
          x,
          req.query.scheme === "tms" ? y : (1 << z) - 1 - y // Default of MBTiles is tms. Flip Y to convert tms scheme => xyz scheme
        );
      } else if (item.sourceType === "pmtiles") {
        md5 = await getPMTilesTileMD5(
          item.source,
          z,
          x,
          req.query.scheme === "tms" ? (1 << z) - 1 - y : y // Default of PMTiles is xyz. Flip Y to convert xyz scheme => tms scheme
        );
      } else if (item.sourceType === "xyz") {
        md5 = await getXYZTileMD5(
          item.source,
          z,
          x,
          req.query.scheme === "tms" ? (1 << z) - 1 - y : y, // Default of XYZ is xyz. Flip Y to convert xyz scheme => tms scheme
          req.params.format
        );
      }

      /* Add MD5 to header */
      res.set({
        Etag: md5,
      });

      return res.status(StatusCodes.OK).send();
    } catch (error) {
      printLog(
        "error",
        `Failed to get md5 data "${id}" - Tile "${z}/${x}/${y}": ${error}`
      );

      if (error.message === "Tile MD5 does not exist") {
        return res.status(StatusCodes.NO_CONTENT).send(error.message);
      }

      return res
        .status(StatusCodes.INTERNAL_SERVER_ERROR)
        .send("Internal server error");
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
      const result = await Promise.all(
        Object.keys(config.repo.datas).map(async (id) => {
          return {
            id: id,
            name: config.repo.datas[id].tileJSON.name,
            url: `${getRequestHost(req)}datas/${id}.json`,
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
      const result = await Promise.all(
        Object.keys(config.repo.datas).map(async (id) => {
          const item = config.repo.datas[id];

          return {
            ...item.tileJSON,
            tilejson: "2.2.0",
            id: id,
            tiles: [
              `${getRequestHost(req)}datas/${id}/{z}/{x}/{y}.${
                item.tileJSON.format
              }${req.query.scheme === "tms" ? "?scheme=tms" : ""}`,
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
    const app = express();

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
     *         description: Data ID
     *     responses:
     *       200:
     *         description: Data information
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
     *         description: Tile format
     *       - in: query
     *         name: scheme
     *         schema:
     *           type: string
     *           enum: [xyz, tms]
     *         required: false
     *         description: Use xyz or tms scheme
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
     *         description: Tile format
     *       - in: query
     *         name: scheme
     *         schema:
     *           type: string
     *           enum: [xyz, tms]
     *         required: false
     *         description: Use xyz or tms scheme
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
      `/:id/md5/:z(\\d+)/:x(\\d+)/:y(\\d+).:format(jpeg|jpg|pbf|png|webp|gif)`,
      checkReadyMiddleware(),
      getDataTileMD5Handler()
    );

    return app;
  },

  add: async () => {
    const seed = await readSeedFile(process.env.DATA_DIR, true);

    await Promise.all(
      Object.keys(config.datas).map(async (id) => {
        try {
          const item = config.datas[id];
          const dataInfo = {};

          if (item.mbtiles !== undefined) {
            if (
              item.mbtiles.startsWith("https://") === true ||
              item.mbtiles.startsWith("http://") === true
            ) {
              dataInfo.path = `${process.env.DATA_DIR}/mbtiles/${id}/${id}.mbtiles`;

              if ((await isExistFile(dataInfo.path)) === false) {
                await downloadMBTilesFile(
                  item.mbtiles,
                  dataInfo.path,
                  5,
                  3600000 // 1 hour
                );
              }
            } else {
              dataInfo.path = `${process.env.DATA_DIR}/mbtiles/${item.mbtiles}`;
            }

            if (config.options.createMetadataIndex === true) {
              await createMBTilesIndex(
                dataInfo.path,
                "metadata_unique_index",
                "metadata",
                ["name"]
              );
            }

            if (config.options.createTilesIndex === true) {
              await createMBTilesIndex(
                dataInfo.path,
                "tiles_unique_index",
                "tiles",
                ["zoom_level", "tile_column", "tile_row"]
              );
            }

            dataInfo.sourceType = "mbtiles";
            dataInfo.source = await openMBTiles(dataInfo.path);
            dataInfo.tileJSON = await getMBTilesInfos(dataInfo.source);
          } else if (item.pmtiles !== undefined) {
            if (
              item.pmtiles.startsWith("https://") === true ||
              item.pmtiles.startsWith("http://") === true
            ) {
              dataInfo.path = item.pmtiles;
            } else {
              dataInfo.path = `${process.env.DATA_DIR}/pmtiles/${item.pmtiles}`;
            }

            dataInfo.sourceType = "pmtiles";
            dataInfo.source = openPMTiles(dataInfo.path);
            dataInfo.tileJSON = await getPMTilesInfos(dataInfo.source);
          } else if (item.xyz !== undefined) {
            let cacheSource;

            if (item.cache !== undefined) {
              dataInfo.path = `${process.env.DATA_DIR}/caches/xyzs/${item.xyz}`;

              cacheSource = seed.datas[item.xyz];

              if (cacheSource === undefined) {
                throw new Error(`Cache data id "${item.xyz}" is invalid`);
              }

              if (item.cache.forward === true) {
                dataInfo.sourceURL = cacheSource.url;
                dataInfo.storeCache = item.cache.store;
                dataInfo.storeMD5 = cacheSource.storeMD5;
                dataInfo.storeTransparent = cacheSource.storeTransparent;
              }
            } else {
              dataInfo.path = `${process.env.DATA_DIR}/xyzs/${item.xyz}`;
            }

            dataInfo.sourceType = "xyz";
            dataInfo.source = dataInfo.path;

            if (item.cache !== undefined) {
              dataInfo.tileJSON = createMetadata(cacheSource.metadata);
            } else {
              dataInfo.tileJSON = await getXYZInfos(dataInfo.source);
            }
          }

          /* Validate info */
          validateDataInfo(dataInfo.tileJSON);

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
