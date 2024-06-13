"use strict";

import fs from "node:fs";
import path from "node:path";
import express from "express";
import handlebars from "handlebars";
import SphericalMercator from "@mapbox/sphericalmercator";
import { getTileUrls } from "./utils.js";

const mercator = new SphericalMercator();

export const serve_template = {
  init: async (config) => {
    const app = express().use(
      "/",
      express.static(path.resolve("public", "resources"))
    );

    if (config.options.frontPage === true) {
      app.get("/$", async (req, res, next) => {
        const styles = {};
        const datas = {};

        const renderedPromises = Object.keys(config.repo.rendered).map(
          async (id) => {
            const style = config.repo.rendered[id];
            const { center, tiles, format = "", name = "" } = style.tileJSON;
            const tileSize = 256;
            const xyzLink = getTileUrls(
              req,
              tiles,
              `styles/${id}`,
              tileSize,
              format
            )[0];

            let viewerHash = "";
            let thumbnail = "";
            if (center) {
              viewerHash = `#${center[2]}/${center[1].toFixed(5)}/${center[0].toFixed(5)}`;

              const centerPx = mercator.px([center[0], center[1]], center[2]);

              thumbnail = `${center[2]}/${Math.floor(centerPx[0] / tileSize)}/${Math.floor(centerPx[1] / tileSize)}.png`;
            }

            styles[id] = {
              xyz_link: xyzLink,
              viewer_hash: viewerHash,
              thumbnail: thumbnail,
              name: name,
              serve_wmts: config.options.serveWMTS === true,
            };
          }
        );

        const dataPromises = Object.keys(config.repo.data).map(async (id) => {
          const data = config.repo.data[id];
          const {
            center,
            filesize,
            format = "",
            tiles,
            name = "",
          } = data.tileJSON;
          const tileSize = 256;
          const xyzLink = getTileUrls(
            req,
            tiles,
            `data/${id}`,
            undefined,
            format
          )[0];

          let viewerHash = "";
          let thumbnail = "";
          if (center) {
            viewerHash = `#${center[2]}/${center[1].toFixed(5)}/${center[0].toFixed(5)}`;

            if (format !== "pbf") {
              const centerPx = mercator.px([center[0], center[1]], center[2]);

              thumbnail = `${center[2]}/${Math.floor(centerPx[0] / tileSize)}/${Math.floor(centerPx[1] / tileSize)}.${format}`;
            }
          }

          let formattedFilesize = "unknown";
          if (filesize) {
            let suffix = "kB";
            let size = parseInt(filesize, 10) / 1024;

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
            xyz_link: xyzLink,
            viewer_hash: viewerHash,
            thumbnail: thumbnail,
            source_type: data.sourceType,
            is_vector: format === "pbf",
            formatted_filesize: formattedFilesize,
            name: name,
          };
        });

        await Promise.all([...renderedPromises, ...dataPromises]);

        const serveData = {
          styles: Object.keys(styles).length ? styles : null,
          data: Object.keys(datas).length ? datas : null,
          key_query_part: req.query.key
            ? `key=${encodeURIComponent(req.query.key)}&amp;`
            : "",
          key_query: req.query.key
            ? `?key=${encodeURIComponent(req.query.key)}`
            : "",
        };

        const templatePath = path.resolve("public", "templates", "index.tmpl");
        const file = fs.readFileSync(templatePath);

        const compiled = handlebars.compile(file.toString());

        return res.status(200).send(compiled(serveData));
      });
    }

    app.get("/styles/:id/$", async (req, res, next) => {
      const id = decodeURI(req.params.id);
      const style = config.repo.rendered[id];
      const { name = "" } = style.tileJSON;

      if (!style) {
        res.header("Content-Type", "text/plain");

        return res.status(404).send("Style is not found");
      }

      const serveData = {
        id: id,
        name: name,
        key_query_part: req.query.key
          ? `key=${encodeURIComponent(req.query.key)}&amp;`
          : "",
        key_query: req.query.key
          ? `?key=${encodeURIComponent(req.query.key)}`
          : "",
      };

      const templatePath = path.resolve("public", "templates", "viewer.tmpl");

      const file = fs.readFileSync(templatePath);

      const compiled = handlebars.compile(file.toString());

      return res.status(200).send(compiled(serveData));
    });

    if (config.options.serveWMTS === true) {
      app.get("/styles/:id/wmts.xml", async (req, res, next) => {
        const id = decodeURI(req.params.id);
        const wmts = config.repo.rendered[id];
        const { name = "" } = wmts.tileJSON;

        if (!wmts) {
          res.header("Content-Type", "text/plain");

          return res.status(404).send("WMTS is not found");
        }

        const serveData = {
          id: id,
          name: name,
          base_url: `${req.get("X-Forwarded-Protocol") ? req.get("X-Forwarded-Protocol") : req.protocol}://${req.get("host")}/`,
          key_query_part: req.query.key
            ? `key=${encodeURIComponent(req.query.key)}&amp;`
            : "",
          key_query: req.query.key
            ? `?key=${encodeURIComponent(req.query.key)}`
            : "",
        };

        const templatePath = path.resolve("public", "templates", "wmts.tmpl");
        const file = fs.readFileSync(templatePath);

        const compiled = handlebars.compile(file.toString());

        res.header("Content-Type", "text/xml");

        return res.status(200).send(compiled(serveData));
      });
    }

    app.use("/data/:id/$", async (req, res, next) => {
      const id = decodeURI(req.params.id);
      const data = config.repo.data[id];
      const { name = "", format } = data.tileJSON;

      if (!data) {
        res.header("Content-Type", "text/plain");

        return res.status(404).send("Data is not found");
      }

      const serveData = {
        id: id,
        name: name,
        is_vector: format === "pbf",
        key_query_part: req.query.key
          ? `key=${encodeURIComponent(req.query.key)}&amp;`
          : "",
        key_query: req.query.key
          ? `?key=${encodeURIComponent(req.query.key)}`
          : "",
      };

      const templatePath = path.resolve("public", "templates", "data.tmpl");
      const file = fs.readFileSync(templatePath);

      const compiled = handlebars.compile(file.toString());

      return res.status(200).send(compiled(serveData));
    });

    return app;
  },
};
