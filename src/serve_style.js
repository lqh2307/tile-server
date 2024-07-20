"use strict";

import fs from "node:fs";
import path from "node:path";
import express from "express";
import { validateStyleMin } from "@maplibre/maplibre-gl-style-spec";
import { printLog, getURL } from "./utils.js";
import { serve_rendered } from "./serve_rendered.js";

function getStyleHandler(config) {
  return async (req, res, next) => {
    const id = decodeURI(req.params.id);
    const item = config.repo.styles[id];

    if (!item) {
      return res.status(404).send("Style is not found");
    }

    /* Clone style JSON */
    const styleJSON = {
      ...item.styleJSON,
      sources: {},
    };

    /* Fix sprite url */
    if (styleJSON.sprite !== undefined) {
      if (styleJSON.sprite.startsWith("sprites://") === true) {
        styleJSON.sprite = styleJSON.sprite.replace(
          "sprites://",
          `${getURL(req)}sprites/`
        );
      }
    }

    /* Fix fonts url */
    if (styleJSON.glyphs !== undefined) {
      if (styleJSON.glyphs.startsWith("fonts://") === true) {
        styleJSON.glyphs = styleJSON.glyphs.replace(
          "fonts://",
          `${getURL(req)}fonts/`
        );
      }
    }

    /* Fix source urls */
    Object.keys(item.styleJSON.sources).forEach((name) => {
      const oldSource = item.styleJSON.sources[name];

      styleJSON.sources[name] = {
        ...oldSource,
      };

      if (oldSource.url !== undefined) {
        if (
          oldSource.url.startsWith("mbtiles://") === true ||
          oldSource.url.startsWith("pmtiles://") === true
        ) {
          const sourceID = oldSource.url.slice(10);

          styleJSON.sources[name].url = `${getURL(req)}data/${sourceID}.json`;
        }
      } else if (oldSource.urls !== undefined) {
        styleJSON.sources[name].urls = oldSource.urls.map((sourceURL) => {
          if (
            sourceURL.startsWith("pmtiles://") === true ||
            sourceURL.startsWith("mbtiles://") === true
          ) {
            const sourceID = sourceURL.slice(10);

            sourceURL = `${getURL(req)}data/${sourceID}.json`;
          }

          return sourceURL;
        });
      } else if (oldSource.tiles !== undefined) {
        styleJSON.sources[name].tiles = oldSource.tiles.map((tileURL) => {
          if (
            tileURL.startsWith("pmtiles://") === true ||
            tileURL.startsWith("mbtiles://") === true
          ) {
            const sourceID = tileURL.slice(10);

            tileURL = `${getURL(req)}data/${sourceID}/{z}/{x}/{y}.${
              config.repo.datas[sourceID].tileJSON.format
            }`;
          }

          return tileURL;
        });
      }
    });

    res.header("Content-Type", "application/json");

    return res.status(200).send(styleJSON);
  };
}

function getStylesListHandler(config) {
  return async (req, res, next) => {
    const styles = config.repo.styles;

    const result = Object.keys(styles).map((style) => {
      const item = styles[style];

      return {
        id: style,
        name: item.styleJSON.name || "",
        url: `${getURL(req)}styles/${style}/style.json`,
      };
    });

    return res.status(200).send(result);
  };
}

export const serve_style = {
  init: (config) => {
    const app = express();

    /* Get style */
    app.get("/:id/style.json", getStyleHandler(config));

    /* Get all styles */
    app.get("/styles.json", getStylesListHandler(config));

    /* Serve rendered */
    if (config.options.serveRendered === true) {
      app.use("/styles", serve_rendered.init(config));
    }

    return app;
  },

  add: async (config) => {
    await Promise.all(
      Object.keys(config.styles).map(async (style) => {
        const stylePath = config.styles[style].style;

        try {
          if (!stylePath) {
            throw Error(`"style" property is empty`);
          }

          const filePath = path.join(config.options.paths.styles, stylePath);

          const file = fs.readFileSync(filePath);

          const styleJSON = JSON.parse(file);

          /* Validate style */
          const validationErrors = validateStyleMin(styleJSON);
          if (validationErrors.length > 0) {
            let errString = "Style is invalid:";

            for (const error of validationErrors) {
              errString += "\n\t" + `${error.message}`;
            }

            throw Error(errString);
          }

          /* Validate fonts */
          if (styleJSON.glyphs !== undefined) {
            if (
              styleJSON.glyphs.startsWith("fonts://") === false &&
              styleJSON.glyphs.startsWith("https://") === false &&
              styleJSON.glyphs.startsWith("http://") === false
            ) {
              throw Error("Invalid fonts url");
            }
          }

          /* Validate sprite */
          if (styleJSON.sprite !== undefined) {
            if (styleJSON.sprite.startsWith("sprites://") === true) {
              const spriteID = styleJSON.sprite.slice(
                10,
                styleJSON.sprite.lastIndexOf("/")
              );

              if (!config.repo.sprites[spriteID]) {
                throw Error(`Sprite "${spriteID}" is not found`);
              }
            } else if (
              styleJSON.sprite.startsWith("https://") === false &&
              styleJSON.sprite.startsWith("http://") === false
            ) {
              throw Error("Invalid sprite url");
            }
          }

          /* Validate sources */
          Object.keys(styleJSON.sources).forEach((source) => {
            const sourceURL = styleJSON.sources[source].url;
            const sourceURLs = styleJSON.sources[source].urls;
            const sourceTiles = styleJSON.sources[source].tiles;

            if (
              sourceURL !== undefined &&
              sourceURLs !== undefined &&
              sourceTiles !== undefined
            ) {
              throw Error(`Source "${source}" is invalid`);
            } else if (sourceURL !== undefined) {
              if (
                sourceURL.startsWith("pmtiles://") === true ||
                sourceURL.startsWith("mbtiles://") === true
              ) {
                const sourceID = sourceURL.slice(10);

                if (!config.repo.datas[sourceID]) {
                  throw Error(`Source "${source}" is not found`);
                }
              } else if (
                sourceURL.startsWith("https://") === false &&
                sourceURL.startsWith("http://") === false
              ) {
                throw Error(`Source "${source}" is invalid url`);
              }
            } else if (sourceURLs !== undefined) {
              sourceURLs.forEach((sourceURL) => {
                if (
                  sourceURL.startsWith("pmtiles://") === true ||
                  sourceURL.startsWith("mbtiles://") === true
                ) {
                  const sourceID = sourceURL.slice(10);

                  if (!config.repo.datas[sourceID]) {
                    throw Error(`Source "${source}" is not found`);
                  }
                } else if (
                  sourceURL.startsWith("https://") === false &&
                  sourceURL.startsWith("http://") === false
                ) {
                  throw Error(`Source "${source}" is invalid urls`);
                }
              });
            } else if (sourceTiles !== undefined) {
              sourceTiles.forEach((sourceTile) => {
                if (
                  sourceTile.startsWith("pmtiles://") === true ||
                  sourceTile.startsWith("mbtiles://") === true
                ) {
                  const sourceID = sourceURL.slice(10);

                  if (!config.repo.datas[sourceID]) {
                    throw Error(`Source "${source}" is not found`);
                  }
                } else if (
                  sourceTile.startsWith("https://") === false &&
                  sourceTile.startsWith("http://") === false
                ) {
                  throw Error(`Source "${source}" is invalid tile urls`);
                }
              });
            }
          });

          /* Add to repo */
          config.repo.styles[style] = {
            styleJSON: styleJSON,
          };
        } catch (error) {
          printLog(
            "error",
            `Failed to load style "${style}": ${error}. Skipping...`
          );
        }
      })
    );

    if (config.options.serveRendered === true) {
      await serve_rendered.add(config);
    }
  },
};
