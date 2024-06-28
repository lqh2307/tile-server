"use strict";

import fs from "node:fs";
import path from "node:path";
import express from "express";
import handlebars from "handlebars";
import SphericalMercator from "@mapbox/sphericalmercator";
import { getUrl } from "./utils.js";

const mercator = new SphericalMercator();

function serveFrontPageHandler(config) {
  return async (req, res, next) => {
    if (config.options.frontPage === false) {
      return res.status(404).send("Front page is not support");
    }

    const styles = {};
    const renderedPromises = Object.keys(config.repo.rendered).map(
      async (id) => {
        const style = config.repo.rendered[id];
        const { center, format, name = "" } = style.tileJSON;
        const tileSize = 256;

        let viewerHash = "";
        let thumbnail = "";
        if (center) {
          viewerHash = `#${center[2]}/${center[1].toFixed(5)}/${center[0].toFixed(5)}`;

          const centerPx = mercator.px([center[0], center[1]], center[2]);

          thumbnail = `${center[2]}/${Math.floor(centerPx[0] / tileSize)}/${Math.floor(centerPx[1] / tileSize)}.png`;
        }

        styles[id] = {
          name: name,
          xyz_link: `${getUrl(req)}styles/${id}/${tileSize}/{z}/{x}/{y}.${format}`,
          viewer_hash: viewerHash,
          thumbnail: thumbnail,
          serve_wmts: config.options.serveWMTS === true,
        };
      }
    );

    const datas = {};
    const dataPromises = Object.keys(config.repo.data).map(async (id) => {
      const data = config.repo.data[id];
      const { center, format, filesize, name = "" } = data.tileJSON;

      let viewerHash = "";
      let thumbnail = "";
      if (center) {
        const tileSize = 256;

        viewerHash = `#${center[2]}/${center[1].toFixed(5)}/${center[0].toFixed(5)}`;

        if (format !== "pbf") {
          const centerPx = mercator.px([center[0], center[1]], center[2]);

          thumbnail = `${center[2]}/${Math.floor(centerPx[0] / tileSize)}/${Math.floor(centerPx[1] / tileSize)}.${format}`;
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
        xyz_link: `${getUrl(req)}data/${id}/{z}/{x}/{y}.${format}`,
        viewer_hash: viewerHash,
        thumbnail: thumbnail,
        source_type: data.sourceType,
        is_vector: format === "pbf",
        formatted_filesize: formattedFilesize,
        name: name,
      };
    });

    await Promise.all([...renderedPromises, ...dataPromises]);

    const styleCount = Object.keys(styles).length;
    const dataCount = Object.keys(datas).length;
    const serveData = {
      styles: styleCount ? styles : null,
      data: dataCount ? datas : null,
      style_count: styleCount,
      data_count: dataCount,
    };

    const compiled = handlebars.compile(
      fs
        .readFileSync(path.resolve("public", "templates", "index.tmpl"))
        .toString()
    )(serveData);

    return res.status(200).send(compiled);
  };
}

function serveStyleHandler(config) {
  return async (req, res, next) => {
    const id = decodeURI(req.params.id);
    const style = config.repo.rendered[id];

    if (!style) {
      return res.status(404).send("Style is not found");
    }

    const serveData = {
      id: id,
      name: style.tileJSON.name || "",
    };

    const compiled = handlebars.compile(
      fs
        .readFileSync(path.resolve("public", "templates", "viewer.tmpl"))
        .toString()
    )(serveData);

    return res.status(200).send(compiled);
  };
}

function serveDataHandler(config) {
  return async (req, res, next) => {
    const id = decodeURI(req.params.id);
    const data = config.repo.data[id];

    if (!data) {
      return res.status(404).send("Data is not found");
    }

    const serveData = {
      id: id,
      name: data.tileJSON.name || "",
      is_vector: data.tileJSON.format === "pbf",
    };

    const compiled = handlebars.compile(
      fs
        .readFileSync(path.resolve("public", "templates", "data.tmpl"))
        .toString()
    )(serveData);

    return res.status(200).send(compiled);
  };
}

function serveWMTSHandler(config) {
  return async (req, res, next) => {
    if (config.options.frontPage === false) {
      return res.status(404).send("WMTS is not support");
    }

    const id = decodeURI(req.params.id);
    const wmts = config.repo.rendered[id];

    if (!wmts) {
      return res.status(404).send("WMTS is not found");
    }

    const serveData = {
      id: id,
      name: wmts.tileJSON.name || "",
      base_url: `${req.get("X-Forwarded-Protocol") ? req.get("X-Forwarded-Protocol") : req.protocol}://${req.get("host")}/`,
    };

    const compiled = handlebars.compile(
      fs
        .readFileSync(path.resolve("public", "templates", "wmts.tmpl"))
        .toString()
    )(serveData);

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

    app.get("/styles/:id/wmts.xml", serveWMTSHandler(config));
    app.get("/styles/:id/$", serveStyleHandler(config));
    app.use("/data/:id/$", serveDataHandler(config));
    app.get("/$", serveFrontPageHandler(config));

    return app;
  },
};
