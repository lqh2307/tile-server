"use strict";

import { StatusCodes } from "http-status-codes";
import { printLog } from "./logger.js";
import { config } from "./config.js";
import express from "express";
import {
  getXYZFromLonLatZ,
  compileTemplate,
  getRequestHost,
  getStyle,
} from "./utils.js";

function serveFrontPageHandler() {
  return async (req, res, next) => {
    const styles = {};
    const datas = {};
    const fonts = {};
    const sprites = {};

    await Promise.all([
      ...(() => {
        if (config.options.serveRendered === true) {
          return Object.keys(config.repo.rendereds).map(async (id) => {
            const { name, center } = config.repo.rendereds[id].tileJSON;

            const [x, y, z] = getXYZFromLonLatZ(
              center[0],
              center[1],
              center[2]
            );

            styles[id] = {
              name: name,
              xyz: `${getRequestHost(
                req
              )}styles/${id}/{z}/{x}/{y}.png?scheme=xyz`,
              tms: `${getRequestHost(
                req
              )}styles/${id}/{z}/{x}/{y}.png?scheme=tms`,
              viewer_hash: `#${center[2]}/${center[1]}/${center[0]}`,
              thumbnail: `${getRequestHost(
                req
              )}styles/${id}/${z}/${x}/${y}.png`,
              serve_wmts: config.options.serveWMTS === true,
              serve_rendered: true,
            };
          });
        } else {
          return Object.keys(config.repo.styles).map(async (id) => {
            const {
              name = "Unknown",
              zoom = 0,
              center = [0, 0],
            } = await getStyle(config.repo.styles[id].path);

            styles[id] = {
              name: name,
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
          const [x, y, z] = getXYZFromLonLatZ(center[0], center[1], center[2]);

          thumbnail = `${getRequestHost(
            req
          )}datas/${id}/${z}/${x}/${y}.${format}`;
        }

        datas[id] = {
          name: name,
          xyz: `${getRequestHost(
            req
          )}datas/${id}/{z}/{x}/{y}.${format}?scheme=xyz`,
          tms: `${getRequestHost(
            req
          )}datas/${id}/{z}/{x}/{y}.${format}?scheme=tms`,
          viewer_hash: `#${center[2]}/${center[1]}/${center[0]}`,
          thumbnail: thumbnail,
          source_type: data.sourceType,
          is_vector: format === "pbf",
        };
      }),
      ...Object.keys(config.repo.fonts).map(async (id) => {
        fonts[id] = {
          name: id,
          font: `${getRequestHost(req)}fonts/${id}/{range}.pbf`,
        };
      }),
      ...Object.keys(config.repo.sprites).map(async (id) => {
        sprites[id] = {
          name: id,
          sprite: `${getRequestHost(req)}sprites/${id}/sprite`,
          thumbnail: `${getRequestHost(req)}sprites/${id}/sprite.png`,
        };
      }),
    ]);

    try {
      const compiled = await compileTemplate("index", {
        styles: styles,
        datas: datas,
        fonts: fonts,
        sprites: sprites,
        style_count: Object.keys(styles).length,
        data_count: Object.keys(datas).length,
        font_count: Object.keys(fonts).length,
        sprite_count: Object.keys(sprites).length,
      });

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
    const id = req.params.id;
    const item = config.repo.styles[id];

    if (item === undefined) {
      return res.status(StatusCodes.NOT_FOUND).send("Style is not found");
    }

    /* Get style JSON */
    const { name = "Unknown" } = await getStyle(item.path);

    try {
      const compiled = await compileTemplate("viewer", {
        id: id,
        name: name,
      });

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
    const id = req.params.id;
    const item = config.repo.datas[id];

    if (item === undefined) {
      return res.status(StatusCodes.NOT_FOUND).send("Data is not found");
    }

    try {
      const compiled = await compileTemplate("data", {
        id: id,
        name: item.tileJSON.name,
        is_vector: item.tileJSON.format === "pbf",
      });

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
    const id = req.params.id;
    const item = config.repo.rendereds[id];

    if (item === undefined) {
      return res.status(StatusCodes.NOT_FOUND).send("WMTS is not found");
    }

    try {
      const compiled = await compileTemplate("wmts", {
        id: id,
        name: item.tileJSON.name,
        base_url: getRequestHost(req),
      });

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
    const app = express().use("/", express.static("public/resources"));

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
      app.get("/styles/:id/$", serveStyleHandler());

      /* Serve data */
      /**
       * @swagger
       * tags:
       *   - name: Template
       *     description: Template related endpoints
       * /datas/{id}/:
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
      app.use("/datas/:id/$", serveDataHandler());

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
      app.get("/$", serveFrontPageHandler());
    }

    return app;
  },
};
