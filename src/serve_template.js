"use strict";

import fs from "node:fs";
import path from "node:path";
import express from "express";
import handlebars from "handlebars";
import SphericalMercator from "@mapbox/sphericalmercator";
import { getURL } from "./utils.js";

const mercator = new SphericalMercator();

function serveFrontPageHandler(config) {
  return async (req, res, next) => {
    if (config.startupComplete === false) {
      return res.status(503).send("Starting");
    }

    const styles = {};
    const datas = {};

    await Promise.all([
      ...Object.keys(config.repo.rendereds).map(async (id) => {
        const style = config.repo.rendereds[id];
        const center = style.tileJSON.center;

        let viewerHash = "";
        let thumbnail = "";
        if (center) {
          viewerHash = `#${center[2]}/${center[1]}/${center[0]}`;

          const centerPx = mercator.px([center[0], center[1]], center[2]);
          const x = Math.floor(centerPx[0] / 256);
          const y = Math.floor(centerPx[1] / 256);

          thumbnail = `${center[2]}/${x}/${y}.png`;
        }

        styles[id] = {
          name: style.tileJSON.name || "",
          xyz_link: `${getURL(req)}styles/${id}/256/{z}/{x}/{y}.png`,
          viewer_hash: viewerHash,
          thumbnail: thumbnail,
          serve_wmts: config.options.serveWMTS === true,
        };
      }),
      ...Object.keys(config.repo.datas).map(async (id) => {
        const data = config.repo.datas[id];
        const { center, format, filesize } = data.tileJSON;

        let viewerHash = "";
        let thumbnail = "";
        if (center) {
          viewerHash = `#${center[2]}/${center[1]}/${center[0]}`;

          if (format !== "pbf") {
            const centerPx = mercator.px([center[0], center[1]], center[2]);
            const x = Math.floor(centerPx[0] / 256);
            const y = Math.floor(centerPx[1] / 256);

            thumbnail = `${center[2]}/${x}/${y}.${format}`;
          }
        }

        let formattedFilesize = "unknown";
        if (filesize) {
          let suffix = "kB";
          let size = filesize / 1024;

          if (size > 1024) {
            suffix = "MB";
            size /= 1024;
          }

          if (size > 1024) {
            suffix = "GB";
            size /= 1024;
          }

          formattedFilesize = `${size.toFixed(2)} ${suffix}`;
        }

        datas[id] = {
          name: data.tileJSON.name || "",
          xyz_link: `${getURL(req)}data/${id}/{z}/{x}/{y}.${format}`,
          viewer_hash: viewerHash,
          thumbnail: thumbnail,
          source_type: data.sourceType,
          is_vector: format === "pbf",
          formatted_filesize: formattedFilesize,
        };
      }),
    ]);

    const styleCount = Object.keys(styles).length;
    const dataCount = Object.keys(datas).length;
    const serveData = {
      styles: styleCount ? styles : null,
      data: dataCount ? datas : null,
      style_count: styleCount,
      data_count: dataCount,
    };

    const filePath = path.resolve("public", "templates", "index.tmpl");

    const compiled = handlebars.compile(fs.readFileSync(filePath).toString())(
      serveData
    );

    return res.status(200).send(compiled);
  };
}

function serveStyleHandler(config) {
  return async (req, res, next) => {
    const id = decodeURI(req.params.id);
    const style = config.repo.rendereds[id];

    if (!style) {
      return res.status(404).send("Style is not found");
    }

    const serveData = {
      id: id,
      name: style.tileJSON.name || "",
    };

    const filePath = path.resolve("public", "templates", "viewer.tmpl");

    const compiled = handlebars.compile(fs.readFileSync(filePath).toString())(
      serveData
    );

    return res.status(200).send(compiled);
  };
}

function serveDataHandler(config) {
  return async (req, res, next) => {
    const id = decodeURI(req.params.id);
    const data = config.repo.datas[id];

    if (!data) {
      return res.status(404).send("Data is not found");
    }

    const serveData = {
      id: id,
      name: data.tileJSON.name || "",
      is_vector: data.tileJSON.format === "pbf",
    };

    const filePath = path.resolve("public", "templates", "data.tmpl");

    const compiled = handlebars.compile(fs.readFileSync(filePath).toString())(
      serveData
    );

    return res.status(200).send(compiled);
  };
}

function serveWMTSHandler(config) {
  return async (req, res, next) => {
    const id = decodeURI(req.params.id);
    const wmts = config.repo.rendereds[id];

    if (!wmts) {
      return res.status(404).send("WMTS is not found");
    }

    const serveData = {
      id: id,
      name: wmts.tileJSON.name || "",
      base_url: getURL(req),
    };

    const filePath = path.resolve("public", "templates", "wmts.tmpl");

    const compiled = handlebars.compile(fs.readFileSync(filePath).toString())(
      serveData
    );

    res.header("Content-Type", "text/xml");

    return res.status(200).send(compiled);
  };
}

export const serve_template = {
  init: (config) => {
    const app = express().use(
      "/",
      express.static(path.resolve("public", "resources"))
    );

    if (config.options.serveWMTS === true) {
      app.get("/styles/:id/wmts.xml", serveWMTSHandler(config));
    }

    app.get("/styles/:id/$", serveStyleHandler(config));
    app.use("/data/:id/$", serveDataHandler(config));

    if (config.options.frontPage === true) {
      app.get("/$", serveFrontPageHandler(config));
    }

    return app;
  },
};
