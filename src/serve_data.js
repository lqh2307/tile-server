"use strict";

import { getPMTilesInfos, getPMTilesTile, openPMTiles } from "./pmtiles.js";
import {
  storeXYZTileDataFile,
  getXYZTileFromURL,
  getXYZInfos,
  getXYZTile,
  createXYZTileDataFile,
} from "./xyz.js";
import { StatusCodes } from "http-status-codes";
import { config, seed } from "./config.js";
import express from "express";
import {
  createMBTilesIndex,
  getMBTilesInfos,
  getMBTilesTile,
  openMBTiles,
} from "./mbtiles.js";
import {
  downloadMBTilesFile,
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

    /* Get tile */
    const z = Number(req.params.z);
    const x = Number(req.params.x);
    const y = Number(req.params.y);
    const tileName = `${z}/${x}/${y}`

    try {
      let dataTile;

      if (item.sourceType === "mbtiles") {
        dataTile = await getMBTilesTile(
          item.source,
          z,
          x,
          req.query.scheme === "tms" ? y : (1 << z) - 1 - y // Default of MBTiles is tms. Flip Y to convert tms scheme => xyz scheme
        );
      } else if (item.sourceType === "pmtiles") {
        dataTile = await getPMTilesTile(item.source, z, x, y);
      } else if (item.sourceType === "xyz") {
        if (item.cacheSourceID !== undefined) {
          const cacheItem = seed.tileLocks.datas[item.cacheSourceID]

          try {
            if (cacheItem[tileName] === undefined) {
              dataTile = await getXYZTile(
                item.source,
                z,
                x,
                req.query.scheme === "tms" ? (1 << z) - 1 - y : y, // Default of XYZ is xyz. Flip Y to convert xyz scheme => tms scheme
                req.params.format
              );
            }
          } catch (error) {
            if (error.message === "Tile does not exist") {
              const url = cacheItem.url.replaceAll("{z}/{x}/{y}", tileName);

              printLog("info", `Getting data "${id}" from ${url}...`)

              dataTile = await getXYZTileFromURL(url, 60000)

              if (cacheItem[tileName] === undefined) {
                cacheItem[tileName] = true;

                createXYZTileDataFile(`${item.source}/${tileName}.${req.params.format}`, dataTile.data).catch(error => printLog("error", `Failed to caching data "${id}" from ${url}: ${error}...`)).finally(() => delete cacheItem[tileName])
              }
            }
          }
        } else {
          dataTile = await getXYZTile(
            item.source,
            z,
            x,
            req.query.scheme === "tms" ? (1 << z) - 1 - y : y, // Default of XYZ is xyz. Flip Y to convert xyz scheme => tms scheme
            req.params.format
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
        `Failed to get data "${id}" - Tile ${tileName}: ${error}`
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
      const includeJSON = req.query.json === "true" ? true : false;
      let dataInfo;

      if (item.sourceType === "mbtiles") {
        dataInfo = await getMBTilesInfos(item.source, includeJSON);
      } else if (item.sourceType === "pmtiles") {
        dataInfo = await getPMTilesInfos(item.source, includeJSON);
      } else if (item.sourceType === "xyz") {
        dataInfo = await getXYZInfos(
          item.source,
          req.query.scheme,
          includeJSON
        );
      }

      dataInfo.tiles = [
        `${getRequestHost(req)}datas/${id}/{z}/{x}/{y}.${item.tileJSON.format}${req.query.scheme === "tms" ? "?scheme=tms" : ""
        }`,
      ];

      res.header("Content-Type", "application/json");

      return res.status(StatusCodes.OK).send(dataInfo);
    } catch (error) {
      printLog("error", `Failed to get data "${id}": ${error}`);

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
      const includeJSON = req.query.json === "true" ? true : false;

      const result = await Promise.all(
        Object.keys(config.repo.datas).map(async (id) => {
          const item = config.repo.datas[id];
          let dataInfo;

          if (item.sourceType === "mbtiles") {
            dataInfo = await getMBTilesInfos(item.source, includeJSON);
          } else if (item.sourceType === "pmtiles") {
            dataInfo = await getPMTilesInfos(item.source, includeJSON);
          } else if (item.sourceType === "xyz") {
            dataInfo = await getXYZInfos(
              item.source,
              req.query.scheme,
              includeJSON
            );
          }

          dataInfo.id = id;

          dataInfo.tiles = [
            `${getRequestHost(req)}datas/${id}/{z}/{x}/{y}.${item.tileJSON.format
            }${req.query.scheme === "tms" ? "?scheme=tms" : ""}`,
          ];

          return dataInfo;
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
     *     parameters:
     *       - in: query
     *         name: json
     *         schema:
     *           type: string
     *           enum: [true, false]
     *         required: false
     *         description: Include vector_layers and tilestats fields in response
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
     *       - in: query
     *         name: json
     *         schema:
     *           type: string
     *           enum: [true, false]
     *         required: false
     *         description: Include vector_layers and tilestats fields in response
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
            let dirPath = `${config.paths.xyzs}/${item.xyz}`;

            if (item.cache === true) {
              dirPath = `${config.paths.caches.xyzs}/${item.xyz}`;

              dataInfo.cacheSourceID = item.xyz;
            }

            dataInfo.sourceType = "xyz";
            dataInfo.source = dirPath;
            dataInfo.tileJSON = await getXYZInfos(dataInfo.source);
          } else {
            throw new Error(
              `Missing "pmtiles" or "mbtiles" or "xyz" property of data`
            );
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
