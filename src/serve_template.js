"use strict";

import { StatusCodes } from "http-status-codes";
import { config } from "./config.js";
import express from "express";
import path from "node:path";
import {
  getXYZCenterFromLonLatZ,
  compileTemplate,
  getRequestHost,
} from "./utils.js";

function checkHealth() {
  return (req, res, next) => {
    if (config.startupComplete === false) {
      return res.status(StatusCodes.SERVICE_UNAVAILABLE).send("Starting...");
    }

    next();
  };
}

function serveFrontPageHandler() {
  return async (req, res, next) => {
    const styles = {};
    const datas = {};

    await Promise.all([
      ...(() => {
        if (config.options.serveRendered === true) {
          return Object.keys(config.repo.rendereds).map(async (id) => {
            const { name, center } = config.repo.rendereds[id].tileJSON;

            const [x, y, z] = getXYZCenterFromLonLatZ(
              center[0],
              center[1],
              center[2]
            );

            styles[id] = {
              name: name,
              xyz_link: `${getRequestHost(
                req
              )}styles/${id}/256/{z}/{x}/{y}.png`,
              viewer_hash: `#${center[2]}/${center[1]}/${center[0]}`,
              thumbnail: `${getRequestHost(
                req
              )}styles/${id}/256/${z}/${x}/${y}.png`,
              serve_wmts: config.options.serveWMTS === true,
              serve_rendered: true,
            };
          });
        } else {
          return Object.keys(config.repo.styles).map(async (id) => {
            const {
              name,
              center = [0, 0],
              zoom = 0,
            } = config.repo.styles[id].styleJSON;

            styles[id] = {
              name: name || "Unknown",
              viewer_hash: `#${zoom}/${center[1]}/${center[0]}`,
              thumbnail: "/images/placeholder.png",
            };
          });
        }
      })(),
      ...Object.keys(config.repo.datas).map(async (id) => {
        const data = config.repo.datas[id];
        const { name, center, format } = data.tileJSON;

        let thumbnail = "/images/placeholder.png";
        if (format !== "pbf") {
          const [x, y, z] = getXYZCenterFromLonLatZ(
            center[0],
            center[1],
            center[2]
          );

          thumbnail = `${getRequestHost(
            req
          )}data/${id}/${z}/${x}/${y}.${format}`;
        }

        datas[id] = {
          name: name,
          xyz_link: `${getRequestHost(req)}data/${id}/{z}/{x}/{y}.${format}`,
          viewer_hash: `#${center[2]}/${center[1]}/${center[0]}`,
          thumbnail: thumbnail,
          source_type: data.sourceType,
          is_vector: format === "pbf",
        };
      }),
    ]);

    const serveData = {
      styles: styles,
      data: datas,
      style_count: Object.keys(styles).length,
      data_count: Object.keys(datas).length,
    };

    try {
      const compiled = await compileTemplate("index", serveData);

      return res.status(StatusCodes.OK).send(compiled);
    } catch (error) {
      printLog("error", `Failed to serve front page": ${error}`);

      return res
        .status(StatusCodes.INTERNAL_SERVER_ERROR)
        .send("Internal server error");
    }
  };
}

function serveStyleHandler() {
  return async (req, res, next) => {
    const id = decodeURI(req.params.id);
    const item = config.repo.styles[id];

    if (item === undefined) {
      return res.status(StatusCodes.NOT_FOUND).send("Style is not found");
    }

    const serveData = {
      id: id,
      name: item.styleJSON.name || "Unknown",
    };

    try {
      const compiled = await compileTemplate("viewer", serveData);

      return res.status(StatusCodes.OK).send(compiled);
    } catch (error) {
      printLog("error", `Failed to serve style "${id}": ${error}`);

      return res
        .status(StatusCodes.INTERNAL_SERVER_ERROR)
        .send("Internal server error");
    }
  };
}

function serveDataHandler() {
  return async (req, res, next) => {
    const id = decodeURI(req.params.id);
    const item = config.repo.datas[id];

    if (item === undefined) {
      return res.status(StatusCodes.NOT_FOUND).send("Data is not found");
    }

    const serveData = {
      id: id,
      name: item.tileJSON.name,
      is_vector: item.tileJSON.format === "pbf",
    };

    try {
      const compiled = await compileTemplate("data", serveData);

      return res.status(StatusCodes.OK).send(compiled);
    } catch (error) {
      printLog("error", `Failed to serve data "${id}": ${error}`);

      return res
        .status(StatusCodes.INTERNAL_SERVER_ERROR)
        .send("Internal server error");
    }
  };
}

function serveWMTSHandler() {
  return async (req, res, next) => {
    const id = decodeURI(req.params.id);
    const item = config.repo.rendereds[id];

    if (item === undefined) {
      return res.status(StatusCodes.NOT_FOUND).send("WMTS is not found");
    }

    const serveData = {
      id: id,
      name: item.tileJSON.name,
      base_url: getRequestHost(req),
    };

    try {
      const compiled = await compileTemplate("wmts", serveData);

      res.header("Content-Type", "text/xml");

      return res.status(StatusCodes.OK).send(compiled);
    } catch (error) {
      printLog("error", `Failed to serve WMTS "${id}": ${error}`);

      return res
        .status(StatusCodes.INTERNAL_SERVER_ERROR)
        .send("Internal server error");
    }
  };
}

export const serve_template = {
  init: () => {
    const app = express().use(
      "/",
      express.static(path.resolve("public", "resources"))
    );

    if (
      config.options.serveRendered === true &&
      config.options.serveWMTS === true
    ) {
      /**
       * @swagger
       * tags:
       *   - name: WMTS
       *     description: WMTS related endpoints
       * /styles/{id}/wmts.xml:
       *   get:
       *     tags:
       *       - WMTS
       *     summary: Get WMTS XML for style
       *     parameters:
       *       - in: path
       *         name: id
       *         schema:
       *           type: string
       *         required: true
       *         description: ID of the style
       *     responses:
       *       200:
       *         description: WMTS XML for the style
       *         content:
       *           text/xml:
       *             schema:
       *               type: string
       *       404:
       *         description: Style not found
       *       500:
       *         description: Internal server error
       */
      app.get("/styles/:id/wmts.xml", serveWMTSHandler());
    }

    if (config.options.frontPage === true) {
      /**
       * @swagger
       * tags:
       *   - name: Template
       *     description: Template related endpoints
       * /styles/{id}/:
       *   get:
       *     tags:
       *       - Template
       *     summary: Serve style page
       *     parameters:
       *       - in: path
       *         name: id
       *         schema:
       *           type: string
       *         required: true
       *         description: ID of the style
       *     responses:
       *       200:
       *         description: Style page
       *         content:
       *           text/html:
       *             schema:
       *               type: string
       *       404:
       *         description: Style not found
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
      app.get("/styles/:id/$", checkHealth(), serveStyleHandler());

      /* Serve data */
      /**
       * @swagger
       * tags:
       *   - name: Template
       *     description: Template related endpoints
       * /data/{id}/:
       *   get:
       *     tags:
       *       - Template
       *     summary: Serve data page
       *     parameters:
       *       - in: path
       *         name: id
       *         schema:
       *           type: string
       *         required: true
       *         description: ID of the data
       *     responses:
       *       200:
       *         description: Data page
       *         content:
       *           text/html:
       *             schema:
       *               type: string
       *       404:
       *         description: Data not found
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
      app.use("/data/:id/$", checkHealth(), serveDataHandler());

      /* Serve front page */
      /**
       * @swagger
       * tags:
       *   - name: Template
       *     description: Template related endpoints
       * /:
       *   get:
       *     tags:
       *       - Template
       *     summary: Serve front page
       *     responses:
       *       200:
       *         description: Front page
       *         content:
       *           text/html:
       *             schema:
       *               type: string
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
      app.get("/$", checkHealth(), serveFrontPageHandler());
    }

    return app;
  },
};
