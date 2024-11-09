"use strict";

import { cacheXYZTileDataFile, getXYZTileFromURL, getXYZTile } from "./xyz.js";
import mlgl from "@maplibre/maplibre-gl-native";
import { StatusCodes } from "http-status-codes";
import { getPMTilesTile } from "./pmtiles.js";
import { getMBTilesTile } from "./mbtiles.js";
import { Worker } from "node:worker_threads";
import { createPool } from "generic-pool";
import { printLog } from "./logger.js";
import { config } from "./config.js";
import express from "express";
import {
  detectFormatAndHeaders,
  getDataTileFromURL,
  createNewTileJSON,
  getRequestHost,
  processImage,
  getFontsPBF,
  unzipAsync,
  renderData,
  getSprite,
  deepClone,
} from "./utils.js";

async function processImageInWorker(data, scale, compression, tileSize, z) {
  return new Promise((resolve, reject) => {
    new Worker("src/process_image_worker.js", {
      workerData: {
        data,
        scale,
        compression,
        tileSize,
        z,
      },
    })
      .on("message", (message) => {
        if (message.error) {
          reject(new Error(message.error));
        } else {
          resolve(Buffer.from(message.data));
        }
      })
      .on("error", (error) => {
        reject(error);
      })
      .on("exit", (code) => {
        if (code !== 0) {
          reject(new Error(`Worker stopped with exit code: ${code}`));
        }
      });
  });
}

function getRenderedTileHandler() {
  return async (req, res, next) => {
    const id = req.params.id;
    const item = config.repo.rendereds[id];

    /* Check rendered is exist? */
    if (item === undefined) {
      return res.status(StatusCodes.NOT_FOUND).send("Rendered is not found");
    }

    /* Check rendered tile scale */
    const scale = Number(req.params.scale?.slice(1, -1)) || 1; // Default tile scale is 1

    if (scale > config.options.maxScaleRender) {
      return res
        .status(StatusCodes.BAD_REQUEST)
        .send("Rendered tile scale is invalid");
    }

    /* Get tile */
    const z = Number(req.params.z);
    const x = Number(req.params.x);
    const y = Number(req.params.y);
    const tileSize = Number(req.params.tileSize) || 256; // Default tile size is 256px x 256px

    try {
      const data = await renderData(
        item,
        scale,
        tileSize,
        x,
        y,
        z,
        req.query.scheme
      );

      const image = await processImage(
        data,
        scale,
        config.options.renderedCompression,
        tileSize,
        z
      );

      // const image = await processImageInWorker(
      //   data,
      //   scale,
      //   config.options.renderedCompression,
      //   tileSize,
      //   z
      // );

      res.header("Content-Type", `image/png`);

      return res.status(StatusCodes.OK).send(image);
    } catch (error) {
      printLog(
        "error",
        `Failed to get rendered "${id}" - Tile "${z}/${x}/${y}: ${error}`
      );

      return res
        .status(StatusCodes.INTERNAL_SERVER_ERROR)
        .send("Internal server error");
    }
  };
}

function getRenderedHandler() {
  return async (req, res, next) => {
    const id = req.params.id;
    const item = config.repo.rendereds[id];

    if (item === undefined) {
      return res.status(StatusCodes.NOT_FOUND).send("Rendered is not found");
    }

    try {
      const renderedInfo = {
        ...item.tileJSON,
        tiles: [
          `${getRequestHost(req)}styles/${id}/${req.params.tileSize || 256
          }/{z}/{x}/{y}.png${req.query.scheme === "tms" ? "?scheme=tms" : ""}`,
        ],
      };

      res.header("Content-Type", "application/json");

      return res.status(StatusCodes.OK).send(renderedInfo);
    } catch (error) {
      printLog("error", `Failed to get rendered "${id}": ${error}`);

      return res
        .status(StatusCodes.INTERNAL_SERVER_ERROR)
        .send("Internal server error");
    }
  };
}

function getRenderedsListHandler() {
  return async (req, res, next) => {
    try {
      const result = await Promise.all(
        Object.keys(config.repo.rendereds).map(async (id) => {
          return {
            id: id,
            name: config.repo.rendereds[id].tileJSON.name,
            url: [
              `${getRequestHost(req)}styles/256/${id}.json`,
              `${getRequestHost(req)}styles/512/${id}.json`,
            ],
          };
        })
      );

      return res.status(StatusCodes.OK).send(result);
    } catch (error) {
      printLog("error", `Failed to get rendereds": ${error}`);

      return res
        .status(StatusCodes.INTERNAL_SERVER_ERROR)
        .send("Internal server error");
    }
  };
}

function getRenderedTileJSONsListHandler() {
  return async (req, res, next) => {
    try {
      const result = await Promise.all(
        Object.keys(config.repo.rendereds).map(async (id) => {
          const item = config.repo.rendereds[id];

          const renderedInfo = {
            ...item.tileJSON,
            id: id,
            tiles: [
              `${getRequestHost(req)}styles/${id}/{z}/{x}/{y}.png${req.query.scheme === "tms" ? "?scheme=tms" : ""
              }`,
            ],
          };

          return renderedInfo;
        })
      );

      return res.status(StatusCodes.OK).send(result);
    } catch (error) {
      printLog("error", `Failed to get rendered tileJSONs": ${error}`);

      return res
        .status(StatusCodes.INTERNAL_SERVER_ERROR)
        .send("Internal server error");
    }
  };
}

export const serve_rendered = {
  init: () => {
    const app = express();

    if (config.options.serveRendered === true) {
      /**
       * @swagger
       * tags:
       *   - name: Rendered
       *     description: Rendered related endpoints
       * /styles/rendereds.json:
       *   get:
       *     tags:
       *       - Rendered
       *     summary: Get all style rendereds
       *     responses:
       *       200:
       *         description: List of all style rendereds
       *         content:
       *           application/json:
       *             schema:
       *               type: array
       *               items:
       *                 type: object
       *                 properties:
       *                   id:
       *                     type: string
       *                     example: style1
       *                   name:
       *                     type: string
       *                     example: Style 1
       *                   url:
       *                     type: array
       *                     items:
       *                       type: string
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
      app.get("/rendereds.json", getRenderedsListHandler());

      /**
       * @swagger
       * tags:
       *   - name: Rendered
       *     description: Rendered related endpoints
       * /styles/tilejsons.json:
       *   get:
       *     tags:
       *       - Rendered
       *     summary: Get all rendered tileJSONs
       *     responses:
       *       200:
       *         description: List of all rendered tileJSONs
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
      app.get("/tilejsons.json", getRenderedTileJSONsListHandler());

      /**
       * @swagger
       * tags:
       *   - name: Rendered
       *     description: Rendered related endpoints
       * /styles/{tileSize}/{id}.json:
       *   get:
       *     tags:
       *       - Rendered
       *     summary: Get style rendered
       *     parameters:
       *       - in: path
       *         name: tileSize
       *         schema:
       *           type: integer
       *           enum: [256, 512]
       *         required: false
       *         description: Tile size (256 or 512)
       *       - in: path
       *         name: id
       *         schema:
       *           type: string
       *         required: true
       *         description: ID of the style rendered
       *       - in: query
       *         name: scheme
       *         schema:
       *           type: string
       *           enum: [xyz, tms]
       *         required: false
       *         description: Use xyz or tms scheme
       *     responses:
       *       200:
       *         description: Style rendered
       *         content:
       *           application/json:
       *             schema:
       *               type: object
       *               properties:
       *                 tileJSON:
       *                   type: object
       *                 tiles:
       *                   type: array
       *                   items:
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
      app.get("/(:tileSize(256|512)/)?:id.json", getRenderedHandler());

      /**
       * @swagger
       * tags:
       *   - name: Rendered
       *     description: Rendered related endpoints
       * /styles/{id}/{tileSize}/{z}/{x}/{y}{scale}.png:
       *   get:
       *     tags:
       *       - Rendered
       *     summary: Get style rendered tile
       *     parameters:
       *       - in: path
       *         name: id
       *         schema:
       *           type: string
       *         required: true
       *         description: ID of the style
       *       - in: path
       *         name: tileSize
       *         schema:
       *           type: integer
       *           enum: [256, 512]
       *         required: false
       *         description: Tile size (256 or 512)
       *       - in: path
       *         name: z
       *         schema:
       *           type: integer
       *         required: true
       *         description: Zoom level
       *       - in: path
       *         name: x
       *         schema:
       *           type: integer
       *         required: true
       *         description: X coordinate
       *       - in: path
       *         name: y
       *         schema:
       *           type: integer
       *         required: true
       *         description: Y coordinate
       *       - in: path
       *         name: scale
       *         schema:
       *           type: string
       *         required: false
       *         description: Scale of the tile (e.g., @2x)
       *       - in: query
       *         name: scheme
       *         schema:
       *           type: string
       *           enum: [xyz, tms]
       *         required: false
       *         description: Use xyz or tms scheme
       *     responses:
       *       200:
       *         description: Style tile
       *         content:
       *           image/png:
       *             schema:
       *               type: string
       *               format: binary
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
        `/:id/(:tileSize(256|512)/)?:z(\\d+)/:x(\\d+)/:y(\\d+):scale(@\\d+x)?.png`,
        getRenderedTileHandler()
      );
    }

    return app;
  },

  add: async () => {
    if (config.options.serveRendered === true) {
      mlgl.on("message", (error) => {
        if (error.severity === "ERROR") {
          printLog("error", `mlgl: ${JSON.stringify(error)}`);
        } else if (error.severity === "WARNING") {
          printLog("warning", `mlgl: ${JSON.stringify(error)}`);
        }
      });

      const emptyDatas = {
        gif: Buffer.from([
          0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00, 0x01, 0x00, 0x80,
          0x00, 0x00, 0x4c, 0x69, 0x71, 0x00, 0x00, 0x00, 0x21, 0xff, 0x0b,
          0x4e, 0x45, 0x54, 0x53, 0x43, 0x41, 0x50, 0x45, 0x32, 0x2e, 0x30,
          0x03, 0x01, 0x00, 0x00, 0x00, 0x21, 0xf9, 0x04, 0x05, 0x00, 0x00,
          0x00, 0x00, 0x2c, 0x00, 0x00, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00,
          0x00, 0x02, 0x02, 0x44, 0x01, 0x00, 0x3b,
        ]),
        png: Buffer.from([
          0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00,
          0x0d, 0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00,
          0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89,
          0x00, 0x00, 0x00, 0x09, 0x70, 0x48, 0x59, 0x73, 0x00, 0x00, 0x03,
          0xe8, 0x00, 0x00, 0x03, 0xe8, 0x01, 0xb5, 0x7b, 0x52, 0x6b, 0x00,
          0x00, 0x00, 0x0d, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x60,
          0x60, 0x60, 0x60, 0x00, 0x00, 0x00, 0x05, 0x00, 0x01, 0xa5, 0xf6,
          0x45, 0x40, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
          0x42, 0x60, 0x82,
        ]),
        jpg: Buffer.from([
          0xff, 0xd8, 0xff, 0xdb, 0x00, 0x43, 0x00, 0x06, 0x04, 0x05, 0x06,
          0x05, 0x04, 0x06, 0x06, 0x05, 0x06, 0x07, 0x07, 0x06, 0x08, 0x0a,
          0x10, 0x0a, 0x0a, 0x09, 0x09, 0x0a, 0x14, 0x0e, 0x0f, 0x0c, 0x10,
          0x17, 0x14, 0x18, 0x18, 0x17, 0x14, 0x16, 0x16, 0x1a, 0x1d, 0x25,
          0x1f, 0x1a, 0x1b, 0x23, 0x1c, 0x16, 0x16, 0x20, 0x2c, 0x20, 0x23,
          0x26, 0x27, 0x29, 0x2a, 0x29, 0x19, 0x1f, 0x2d, 0x30, 0x2d, 0x28,
          0x30, 0x25, 0x28, 0x29, 0x28, 0xff, 0xdb, 0x00, 0x43, 0x01, 0x07,
          0x07, 0x07, 0x0a, 0x08, 0x0a, 0x13, 0x0a, 0x0a, 0x13, 0x28, 0x1a,
          0x16, 0x1a, 0x28, 0x28, 0x28, 0x28, 0x28, 0x28, 0x28, 0x28, 0x28,
          0x28, 0x28, 0x28, 0x28, 0x28, 0x28, 0x28, 0x28, 0x28, 0x28, 0x28,
          0x28, 0x28, 0x28, 0x28, 0x28, 0x28, 0x28, 0x28, 0x28, 0x28, 0x28,
          0x28, 0x28, 0x28, 0x28, 0x28, 0x28, 0x28, 0x28, 0x28, 0x28, 0x28,
          0x28, 0x28, 0x28, 0x28, 0x28, 0x28, 0x28, 0x28, 0xff, 0xc0, 0x00,
          0x11, 0x08, 0x00, 0x01, 0x00, 0x01, 0x03, 0x01, 0x22, 0x00, 0x02,
          0x11, 0x01, 0x03, 0x11, 0x01, 0xff, 0xc4, 0x00, 0x15, 0x00, 0x01,
          0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
          0x00, 0x00, 0x00, 0x00, 0x00, 0x08, 0xff, 0xc4, 0x00, 0x14, 0x10,
          0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
          0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0xff, 0xc4, 0x00, 0x14, 0x01,
          0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
          0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0xff, 0xc4, 0x00, 0x14, 0x11,
          0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
          0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0xff, 0xda, 0x00, 0x0c, 0x03,
          0x01, 0x00, 0x02, 0x11, 0x03, 0x11, 0x00, 0x3f, 0x00, 0x95, 0x00,
          0x07, 0xff, 0xd9,
        ]),
        jpeg: Buffer.from([
          0xff, 0xd8, 0xff, 0xdb, 0x00, 0x43, 0x00, 0x06, 0x04, 0x05, 0x06,
          0x05, 0x04, 0x06, 0x06, 0x05, 0x06, 0x07, 0x07, 0x06, 0x08, 0x0a,
          0x10, 0x0a, 0x0a, 0x09, 0x09, 0x0a, 0x14, 0x0e, 0x0f, 0x0c, 0x10,
          0x17, 0x14, 0x18, 0x18, 0x17, 0x14, 0x16, 0x16, 0x1a, 0x1d, 0x25,
          0x1f, 0x1a, 0x1b, 0x23, 0x1c, 0x16, 0x16, 0x20, 0x2c, 0x20, 0x23,
          0x26, 0x27, 0x29, 0x2a, 0x29, 0x19, 0x1f, 0x2d, 0x30, 0x2d, 0x28,
          0x30, 0x25, 0x28, 0x29, 0x28, 0xff, 0xdb, 0x00, 0x43, 0x01, 0x07,
          0x07, 0x07, 0x0a, 0x08, 0x0a, 0x13, 0x0a, 0x0a, 0x13, 0x28, 0x1a,
          0x16, 0x1a, 0x28, 0x28, 0x28, 0x28, 0x28, 0x28, 0x28, 0x28, 0x28,
          0x28, 0x28, 0x28, 0x28, 0x28, 0x28, 0x28, 0x28, 0x28, 0x28, 0x28,
          0x28, 0x28, 0x28, 0x28, 0x28, 0x28, 0x28, 0x28, 0x28, 0x28, 0x28,
          0x28, 0x28, 0x28, 0x28, 0x28, 0x28, 0x28, 0x28, 0x28, 0x28, 0x28,
          0x28, 0x28, 0x28, 0x28, 0x28, 0x28, 0x28, 0x28, 0xff, 0xc0, 0x00,
          0x11, 0x08, 0x00, 0x01, 0x00, 0x01, 0x03, 0x01, 0x22, 0x00, 0x02,
          0x11, 0x01, 0x03, 0x11, 0x01, 0xff, 0xc4, 0x00, 0x15, 0x00, 0x01,
          0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
          0x00, 0x00, 0x00, 0x00, 0x00, 0x08, 0xff, 0xc4, 0x00, 0x14, 0x10,
          0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
          0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0xff, 0xc4, 0x00, 0x14, 0x01,
          0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
          0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0xff, 0xc4, 0x00, 0x14, 0x11,
          0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
          0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0xff, 0xda, 0x00, 0x0c, 0x03,
          0x01, 0x00, 0x02, 0x11, 0x03, 0x11, 0x00, 0x3f, 0x00, 0x95, 0x00,
          0x07, 0xff, 0xd9,
        ]),
        webp: Buffer.from([
          0x52, 0x49, 0x46, 0x46, 0x40, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42,
          0x50, 0x56, 0x50, 0x38, 0x58, 0x0a, 0x00, 0x00, 0x00, 0x10, 0x00,
          0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x41, 0x4c, 0x50,
          0x48, 0x02, 0x00, 0x00, 0x00, 0x00, 0x00, 0x56, 0x50, 0x38, 0x20,
          0x18, 0x00, 0x00, 0x00, 0x30, 0x01, 0x00, 0x9d, 0x01, 0x2a, 0x01,
          0x00, 0x01, 0x00, 0x01, 0x40, 0x26, 0x25, 0xa4, 0x00, 0x03, 0x70,
          0x00, 0xfe, 0xfd, 0x36, 0x68, 0x00,
        ]),
        other: Buffer.from([]),
      };

      function createRenderer(config, ratio, styleJSON) {
        const renderer = new mlgl.Map({
          mode: "tile",
          ratio: ratio,
          request: async (req, callback) => {
            const url = decodeURIComponent(req.url);
            const parts = url.split("/");
            const protocol = parts[0];

            if (protocol === "sprites:") {
              const id = parts[2];
              const fileName = parts[3];

              try {
                const data = await getSprite(id, fileName);

                callback(null, {
                  data: data,
                });
              } catch (error) {
                callback(error, {
                  data: null,
                });
              }
            } else if (protocol === "fonts:") {
              const ids = parts[2];
              const fileName = parts[3];

              try {
                let data = await getFontsPBF(ids, fileName);

                /* Unzip pbf font */
                const headers = detectFormatAndHeaders(data).headers;
                if (
                  headers["Content-Type"] === "application/x-protobuf" &&
                  headers["Content-Encoding"] !== undefined
                ) {
                  data = await unzipAsync(data);
                }

                callback(null, {
                  data: data,
                });
              } catch (error) {
                callback(error, {
                  data: null,
                });
              }
            } else if (protocol === "mbtiles:" || protocol === "pmtiles:") {
              const sourceID = parts[2];
              const z = Number(parts[3]);
              const x = Number(parts[4]);
              const y = Number(parts[5].slice(0, parts[5].indexOf(".")));
              const sourceData = config.repo.datas[sourceID];
              let scheme = "xyz";

              try {
                const queryIndex = url.lastIndexOf("?");
                if (queryIndex !== -1) {
                  const query = new URLSearchParams(url.slice(queryIndex));

                  scheme = query.get("scheme");
                }

                /* Get rendered tile */
                const dataTile =
                  sourceData.sourceType === "mbtiles"
                    ? await getMBTilesTile(
                      sourceData.source,
                      z,
                      x,
                      scheme === "tms" ? y : (1 << z) - 1 - y // Default of MBTiles is tms. Flip Y to convert tms scheme => xyz scheme
                    )
                    : await getPMTilesTile(
                      sourceData.source,
                      z,
                      x,
                      scheme === "tms" ? (1 << z) - 1 - y : y // Default of PMTiles is xyz. Flip Y to convert xyz scheme => tms scheme
                    );

                /* Unzip pbf rendered tile */
                if (
                  dataTile.headers["Content-Type"] ===
                  "application/x-protobuf" &&
                  dataTile.headers["Content-Encoding"] !== undefined
                ) {
                  dataTile.data = await unzipAsync(dataTile.data);
                }

                callback(null, {
                  data: dataTile.data,
                });
              } catch (error) {
                printLog(
                  "warning",
                  `Failed to get data "${sourceID}" - Tile "${z}/${x}/${y}": ${error}. Serving empty tile...`
                );

                callback(null, {
                  data:
                    emptyDatas[sourceData.tileJSON.format] || emptyDatas.other,
                });
              }
            } else if (protocol === "xyz:") {
              const sourceID = parts[2];
              const z = Number(parts[3]);
              const x = Number(parts[4]);
              const y = Number(parts[5].slice(0, parts[5].indexOf(".")));
              const tileName = `${z}/${x}/${y}`;
              const sourceData = config.repo.datas[sourceID];
              let scheme = "xyz";

              try {
                const queryIndex = url.lastIndexOf("?");
                if (queryIndex !== -1) {
                  const query = new URLSearchParams(url.slice(queryIndex));

                  scheme = query.get("scheme");
                }

                /* Get rendered tile */
                let dataTile;

                try {
                  dataTile = await getXYZTile(
                    sourceData.source,
                    z,
                    x,
                    scheme === "tms" ? (1 << z) - 1 - y : y, // Default of XYZ is xyz. Flip Y to convert xyz scheme => tms scheme
                    sourceData.tileJSON.format
                  );
                } catch (error) {
                  if (sourceData.sourceURL !== undefined) {
                    const url = sourceData.sourceURL.replaceAll(
                      "{z}/{x}/{y}",
                      tileName
                    );

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
                    if (sourceData.storeCache === true) {
                      cacheXYZTileDataFile(
                        sourceData.source,
                        tileName,
                        sourceData.tileJSON.format,
                        dataTile.data,
                        dataTile.etag
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

                /* Unzip pbf rendered tile */
                if (
                  dataTile.headers["Content-Type"] ===
                  "application/x-protobuf" &&
                  dataTile.headers["Content-Encoding"] !== undefined
                ) {
                  dataTile.data = await unzipAsync(dataTile.data);
                }

                callback(null, {
                  data: dataTile.data,
                });
              } catch (error) {
                printLog(
                  "warning",
                  `Failed to get data "${sourceID}" - Tile "${tileName}": ${error}. Serving empty tile...`
                );

                callback(null, {
                  data:
                    emptyDatas[sourceData.tileJSON.format] || emptyDatas.other,
                });
              }
            } else if (protocol === "http:" || protocol === "https:") {
              try {
                const dataTile = await getDataTileFromURL(url, 60000);

                /* Unzip pbf data */
                if (
                  dataTile.headers["Content-Type"] ===
                  "application/x-protobuf" &&
                  dataTile.headers["Content-Encoding"] !== undefined
                ) {
                  dataTile.data = await unzipAsync(dataTile.data);
                }

                callback(null, {
                  data: dataTile.data,
                });
              } catch (error) {
                printLog(
                  "warning",
                  `Failed to get data from "${url}": ${error}. Serving empty tile...`
                );

                const queryIndex = url.lastIndexOf("?");
                const format =
                  queryIndex === -1
                    ? url.slice(url.lastIndexOf(".") + 1)
                    : url.slice(url.lastIndexOf(".") + 1, queryIndex);

                callback(null, {
                  data: emptyDatas[format] || emptyDatas.other,
                });
              }
            }
          },
        });

        renderer.load(styleJSON);

        return renderer;
      }

      function destroyRenderer(renderer) {
        renderer.release();
      }

      await Promise.all(
        Object.keys(config.repo.styles).map(async (id) => {
          try {
            const item = config.repo.styles[id];
            const rendered = {
              tileJSON: createNewTileJSON({
                name: item.styleJSON.name,
                description: item.styleJSON.name,
              }),
              renderers: [],
            };

            /* Fix center */
            if (item.styleJSON.center?.length >= 2 && item.styleJSON.zoom) {
              rendered.tileJSON.center = [
                item.styleJSON.center[0],
                item.styleJSON.center[1],
                Math.floor(item.styleJSON.zoom),
              ];
            }

            /* Clone style JSON */
            const styleJSON = deepClone(item.styleJSON);

            await Promise.all(
              // Fix source urls
              Object.keys(styleJSON.sources).map(async (id) => {
                const source = styleJSON.sources[id];

                if (source.tiles !== undefined) {
                  const tiles = new Set(
                    source.tiles.map((tile) => {
                      if (
                        tile.startsWith("pmtiles://") === true ||
                        tile.startsWith("mbtiles://") === true ||
                        tile.startsWith("xyz://") === true
                      ) {
                        const queryIndex = tile.lastIndexOf("?");
                        const sourceID =
                          queryIndex === -1
                            ? tile.split("/")[2]
                            : tile.split("/")[2].slice(0, queryIndex);
                        const sourceData = config.repo.datas[sourceID];

                        tile = `${sourceData.sourceType
                          }://${sourceID}/{z}/{x}/{y}.${sourceData.tileJSON.format
                          }${queryIndex === -1 ? "" : tile.slice(queryIndex)}`;
                      }

                      return tile;
                    })
                  );

                  source.tiles = Array.from(tiles);
                }

                if (source.urls !== undefined) {
                  const otherUrls = [];

                  source.urls.forEach((url) => {
                    if (
                      url.startsWith("pmtiles://") === true ||
                      url.startsWith("mbtiles://") === true ||
                      url.startsWith("xyz://") === true
                    ) {
                      const queryIndex = url.lastIndexOf("?");
                      const sourceID =
                        queryIndex === -1
                          ? url.split("/")[2]
                          : url.split("/")[2].slice(0, queryIndex);
                      const sourceData = config.repo.datas[sourceID];

                      const tile = `${sourceData.sourceType
                        }://${sourceID}/{z}/{x}/{y}.${sourceData.tileJSON.format
                        }${queryIndex === -1 ? "" : url.slice(queryIndex)}`;

                      if (source.tiles !== undefined) {
                        if (source.tiles.includes(tile) === false) {
                          source.tiles.push(tile);
                        }
                      } else {
                        source.tiles = [tile];
                      }
                    } else {
                      if (otherUrls.includes(url) === false) {
                        otherUrls.push(url);
                      }
                    }
                  });

                  if (otherUrls.length === 0) {
                    delete source.urls;
                  } else {
                    source.urls = otherUrls;
                  }
                }

                if (source.url !== undefined) {
                  if (
                    source.url.startsWith("pmtiles://") === true ||
                    source.url.startsWith("mbtiles://") === true ||
                    source.url.startsWith("xyz://") === true
                  ) {
                    const queryIndex = source.url.lastIndexOf("?");
                    const sourceID =
                      queryIndex === -1
                        ? source.url.split("/")[2]
                        : source.url.split("/")[2].slice(0, queryIndex);
                    const sourceData = config.repo.datas[sourceID];

                    const tile = `${sourceData.sourceType
                      }://${sourceID}/{z}/{x}/{y}.${sourceData.tileJSON.format}${queryIndex === -1 ? "" : source.url.slice(queryIndex)
                      }`;

                    if (source.tiles !== undefined) {
                      if (source.tiles.includes(tile) === false) {
                        source.tiles.push(tile);
                      }
                    } else {
                      source.tiles = [tile];
                    }

                    delete source.url;
                  }
                }

                if (
                  source.url === undefined &&
                  source.urls === undefined &&
                  source.tiles !== undefined
                ) {
                  if (source.tiles.length === 1) {
                    if (
                      source.tiles[0].startsWith("pmtiles://") === true ||
                      source.tiles[0].startsWith("mbtiles://") === true ||
                      source.tiles[0].startsWith("xyz://") === true
                    ) {
                      const sourceID = source.tiles[0].split("/")[2];
                      const sourceData = config.repo.datas[sourceID];

                      styleJSON.sources[id] = {
                        ...sourceData.tileJSON,
                        ...source,
                        tiles: [source.tiles[0]],
                      };
                    }
                  }
                }

                // Add atribution
                if (
                  source.attribution &&
                  rendered.tileJSON.attribution.includes(source.attribution) ===
                  false
                ) {
                  rendered.tileJSON.attribution += ` | ${source.attribution}`;
                }
              })
            );

            /* Create pools */
            for (
              let scale = 0;
              scale < config.options.maxScaleRender;
              scale++
            ) {
              rendered.renderers.push(
                createPool(
                  {
                    create: () => createRenderer(config, scale + 1, styleJSON),
                    destroy: (renderer) => destroyRenderer(renderer),
                  },
                  {
                    min: config.options.minPoolSize,
                    max: config.options.maxPoolSize,
                  }
                )
              );
            }

            /* Add to repo */
            config.repo.rendereds[id] = rendered;
          } catch (error) {
            printLog(
              "error",
              `Failed to load rendered "${id}": ${error}. Skipping...`
            );
          }
        })
      );
    }
  },
};
