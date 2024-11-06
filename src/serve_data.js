"use strict";

import { StatusCodes } from "http-status-codes";
import { config, seed } from "./config.js";
import express from "express";
import {
  isXYZTileDataAvailable,
  cacheXYZTileDataFile,
  getXYZTileFromURL,
  getXYZTileMD5,
  getXYZInfos,
  getXYZTile,
} from "./xyz.js";
import {
  downloadMBTilesFile,
  createMBTilesIndex,
  getMBTilesTileMD5,
  getMBTilesInfos,
  getMBTilesTile,
  openMBTiles,
} from "./mbtiles.js";
import {
  getPMTilesTileMD5,
  getPMTilesInfos,
  getPMTilesTile,
  openPMTiles,
} from "./pmtiles.js";
import {
  validateDataInfo,
  getRequestHost,
  gzipAsync,
  printLog,
} from "./utils.js";

function getDataTileHandler() {
  return async (req, res, next) => {
    const id = decodeURI(req.params.id);
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
        if (item.cacheSourceID !== undefined) {
          const cacheItem = seed.datas[item.cacheSourceID];
          const filePath = `${item.source}/${z}/${x}${
            req.query.scheme === "tms" ? (1 << z) - 1 - y : y
          }.${item.tileJSON.format}`; // Default of XYZ is xyz. Flip Y to convert xyz scheme => tms scheme

          try {
            if ((await isXYZTileDataAvailable(filePath)) === false) {
              const url = cacheItem.url.replaceAll("{z}/{x}/{y}", tileName);

              printLog(
                "info",
                `Getting data "${id}" - Tile "${tileName}" - From "${url}"...`
              );

              /* Get data */
              dataTile = await getXYZTileFromURL(url, 60000);

              /* Cache */
              cacheXYZTileDataFile(
                item.source,
                tileName,
                item.tileJSON.format,
                dataTile.data,
                dataTile.etag
              ).catch((error) =>
                printLog(
                  "error",
                  `Failed to cache data "${id}" - Tile "${tileName}" - From "${url}": ${error}`
                )
              );
            } else {
              dataTile = await getXYZTile(
                item.source,
                z,
                x,
                req.query.scheme === "tms" ? (1 << z) - 1 - y : y, // Default of XYZ is xyz. Flip Y to convert xyz scheme => tms scheme
                item.tileJSON.format
              );
            }
          } catch (error) {
            throw error;
          }
        } else {
          dataTile = await getXYZTile(
            item.source,
            z,
            x,
            req.query.scheme === "tms" ? (1 << z) - 1 - y : y, // Default of XYZ is xyz. Flip Y to convert xyz scheme => tms scheme
            item.tileJSON.format
          );
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

function getDataHandler() {
  return async (req, res, next) => {
    const id = decodeURI(req.params.id);
    const item = config.repo.datas[id];

    if (item === undefined) {
      return res.status(StatusCodes.NOT_FOUND).send("Data is not found");
    }

    try {
      res.header("Content-Type", "application/json");

      return res.status(StatusCodes.OK).send({
        ...item.tileJSON,
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

function getDataTileMD5Handler() {
  return async (req, res, next) => {
    const id = decodeURI(req.params.id);
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

function getDataTileJSONsListHandler() {
  return async (req, res, next) => {
    try {
      const result = await Promise.all(
        Object.keys(config.repo.datas).map(async (id) => {
          const item = config.repo.datas[id];

          return {
            ...item.tileJSON,
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
    app.get("/datas.json", getDatasListHandler());

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
    app.get("/tilejsons.json", getDataTileJSONsListHandler());

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
    app.get("/:id.json", getDataHandler());

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

          if (item.mbtiles !== undefined) {
            let filePath = `${config.paths.mbtiles}/${item.mbtiles}`;

            if (
              item.mbtiles.startsWith("https://") === true ||
              item.mbtiles.startsWith("http://") === true
            ) {
              filePath = `${config.paths.mbtiles}/${id}/${id}.mbtiles`;

              await downloadMBTilesFile(
                item.mbtiles,
                filePath,
                false,
                5,
                3600000 // 1 hour
              );

              item.mbtiles = `${id}/${id}.mbtiles`;
            }

            if (config.options.createMetadataIndex === true) {
              await createMBTilesIndex(
                filePath,
                "metadata_unique_index",
                "metadata",
                ["name"]
              );
            }

            if (config.options.createTilesIndex === true) {
              await createMBTilesIndex(
                filePath,
                "tiles_unique_index",
                "tiles",
                ["zoom_level", "tile_column", "tile_row"]
              );
            }

            dataInfo.sourceType = "mbtiles";
            dataInfo.source = await openMBTiles(filePath);
            dataInfo.tileJSON = await getMBTilesInfos(dataInfo.source);
          } else if (item.pmtiles !== undefined) {
            let filePath = `${config.paths.pmtiles}/${item.pmtiles}`;

            if (
              item.pmtiles.startsWith("https://") === true ||
              item.pmtiles.startsWith("http://") === true
            ) {
              filePath = item.pmtiles;
            }

            dataInfo.sourceType = "pmtiles";
            dataInfo.source = openPMTiles(filePath);
            dataInfo.tileJSON = await getPMTilesInfos(dataInfo.source);
          } else if (item.xyz !== undefined) {
            let filePath = `${config.paths.xyzs}/${item.xyz}`;

            if (item.cache === true) {
              filePath = `${config.paths.caches.xyzs}/${item.xyz}`;

              dataInfo.cacheSourceID = item.xyz;
            }

            dataInfo.sourceType = "xyz";
            dataInfo.source = filePath;
            try {
              dataInfo.tileJSON = await getXYZInfos(dataInfo.source);
            } catch (error) {
              if (item.cache === true) {
                const cacheItem = seed.datas[dataInfo.cacheSourceID];

                dataInfo.tileJSON = {
                  name: cacheItem.name,
                  description: cacheItem.description,
                  format: cacheItem.format,
                  bounds: cacheItem.bounds,
                  center: cacheItem.center,
                  minzoom: Math.min(...cacheItem.zooms),
                  maxzoom: Math.max(...cacheItem.zooms),
                  vector_layers: cacheItem.vector_layers,
                  tilestats: cacheItem.tilestats,
                };
              }
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
