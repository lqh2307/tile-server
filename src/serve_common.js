"use strict";

import { countPostgreSQLTiles, getPostgreSQLSize } from "./tile_postgresql.js";
import { updateConfigFile, readConfigFile, config } from "./config.js";
import { countMBTilesTiles, getMBTilesSize } from "./tile_mbtiles.js";
import { updateCleanUpFile, readCleanUpFile } from "./cleanup.js";
import { seed, readSeedFile, updateSeedFile } from "./seed.js";
import { countXYZTiles, getXYZSize } from "./tile_xyz.js";
import { checkReadyMiddleware } from "./middleware.js";
import { getPMTilesSize } from "./tile_pmtiles.js";
import { StatusCodes } from "http-status-codes";
import { getGeoJSONSize } from "./geojson.js";
import { getSpriteSize } from "./sprite.js";
import swaggerUi from "swagger-ui-express";
import { getStyleSize } from "./style.js";
import swaggerJsdoc from "swagger-jsdoc";
import { getFontSize } from "./font.js";
import { printLog } from "./logger.js";
import express from "express";
import {
  getTilesBoundsFromBBoxs,
  getXYZFromLonLatZ,
  getBBoxFromCircle,
  getBBoxFromPoint,
  compileTemplate,
  getRequestHost,
  isExistFolder,
  getJSONSchema,
  validateJSON,
  getVersion,
} from "./utils.js";

/**
 * Serve front page handler
 * @returns {(req: any, res: any, next: any) => Promise<any>}
 */
function serveFrontPageHandler() {
  return async (req, res, next) => {
    try {
      const styles = {};
      const geojsons = {};
      const geojsonGroups = {};
      const datas = {};
      const sprites = {};
      const fonts = {};

      const requestHost = getRequestHost(req);

      await Promise.all([
        ...Object.keys(config.repo.styles).map(async (id) => {
          const style = config.repo.styles[id];

          if (style.rendered !== undefined) {
            const { name, center } = style.rendered.tileJSON;

            const [x, y, z] = getXYZFromLonLatZ(
              center[0],
              center[1],
              center[2]
            );

            styles[id] = {
              name: name,
              viewer_hash: `#${center[2]}/${center[1]}/${center[0]}`,
              thumbnail: `${requestHost}/styles/${id}/${z}/${x}/${y}.png`,
              cache: style.storeCache === true,
              enable_export: process.env.ENABLE_EXPORT === "true",
            };
          } else {
            const { name, zoom, center } = style;

            styles[id] = {
              name: name,
              viewer_hash: `#${zoom}/${center[1]}/${center[0]}`,
              cache: style.storeCache === true,
            };
          }
        }),
        ...Object.keys(config.repo.geojsons).map(async (id) => {
          geojsonGroups[id] = true;

          Object.keys(config.repo.geojsons[id]).map(async (layer) => {
            const geojson = config.repo.geojsons[id][layer];

            geojsons[`${id}/${layer}`] = {
              group: id,
              layer: layer,
              cache: geojson.storeCache === true,
            };
          });
        }),
        ...Object.keys(config.repo.datas).map(async (id) => {
          const data = config.repo.datas[id];
          const { name, center, format } = data.tileJSON;

          if (format !== "pbf") {
            const [x, y, z] = getXYZFromLonLatZ(
              center[0],
              center[1],
              center[2]
            );

            datas[id] = {
              name: name,
              format: format,
              viewer_hash: `#${center[2]}/${center[1]}/${center[0]}`,
              thumbnail: `${requestHost}/datas/${id}/${z}/${x}/${y}.${format}`,
              source_type: data.sourceType,
              cache: data.storeCache === true,
            };
          } else {
            datas[id] = {
              name: name,
              format: format,
              viewer_hash: `#${center[2]}/${center[1]}/${center[0]}`,
              source_type: data.sourceType,
              cache: data.storeCache === true,
            };
          }
        }),
        ...Object.keys(config.repo.sprites).map(async (id) => {
          sprites[id] = true;
        }),
        ...Object.keys(config.repo.fonts).map(async (id) => {
          fonts[id] = true;
        }),
      ]);

      const compiled = await compileTemplate("index", {
        styles: styles,
        geojsons: geojsons,
        geojson_groups: geojsonGroups,
        datas: datas,
        fonts: fonts,
        sprites: sprites,
        style_count: Object.keys(styles).length,
        geojson_count: Object.keys(geojsons).length,
        geojson_group_count: Object.keys(geojsonGroups).length,
        data_count: Object.keys(datas).length,
        font_count: Object.keys(fonts).length,
        sprite_count: Object.keys(sprites).length,
        base_url: requestHost,
      });

      return res.status(StatusCodes.OK).send(compiled);
    } catch (error) {
      printLog("error", `Failed to serve front page: ${error}`);

      return res
        .status(StatusCodes.INTERNAL_SERVER_ERROR)
        .send("Internal server error");
    }
  };
}

/**
 * Serve style handler
 * @returns {(req: any, res: any, next: any) => Promise<any>}
 */
function serveStyleHandler() {
  return async (req, res, next) => {
    const id = req.params.id;

    try {
      const item = config.repo.styles[id];

      if (item === undefined) {
        return res.status(StatusCodes.NOT_FOUND).send("Style does not exist");
      }

      const compiled = await compileTemplate("viewer", {
        id: id,
        name: item.name,
        base_url: getRequestHost(req),
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

/**
 * Serve data handler
 * @returns {(req: any, res: any, next: any) => Promise<any>}
 */
function serveDataHandler() {
  return async (req, res, next) => {
    const id = req.params.id;

    try {
      const item = config.repo.datas[id];

      if (item === undefined) {
        return res.status(StatusCodes.NOT_FOUND).send("Data does not exist");
      }

      const compiled = await compileTemplate(
        item.tileJSON.format === "pbf" ? "vector_data" : "raster_data",
        {
          id: id,
          name: item.tileJSON.name,
          base_url: getRequestHost(req),
        }
      );

      return res.status(StatusCodes.OK).send(compiled);
    } catch (error) {
      printLog("error", `Failed to serve data "${id}": ${error}`);

      return res
        .status(StatusCodes.INTERNAL_SERVER_ERROR)
        .send("Internal server error");
    }
  };
}

/**
 * Serve GeoJSON group handler
 * @returns {(req: any, res: any, next: any) => Promise<any>}
 */
function serveGeoJSONGroupHandler() {
  return async (req, res, next) => {
    const id = req.params.id;

    try {
      const item = config.repo.geojsons[id];

      if (item === undefined) {
        return res
          .status(StatusCodes.NOT_FOUND)
          .send("GeoJSON group does not exist");
      }

      const compiled = await compileTemplate("geojson_group", {
        id: id,
        base_url: getRequestHost(req),
      });

      return res.status(StatusCodes.OK).send(compiled);
    } catch (error) {
      printLog("error", `Failed to serve GeoJSON group "${id}": ${error}`);

      return res
        .status(StatusCodes.INTERNAL_SERVER_ERROR)
        .send("Internal server error");
    }
  };
}

/**
 * Serve GeoJSON handler
 * @returns {(req: any, res: any, next: any) => Promise<any>}
 */
function serveGeoJSONHandler() {
  return async (req, res, next) => {
    const id = req.params.id;

    try {
      const item = config.repo.geojsons[id];

      if (item === undefined) {
        return res
          .status(StatusCodes.NOT_FOUND)
          .send("GeoJSON group does not exist");
      }

      if (item[req.params.layer] === undefined) {
        return res
          .status(StatusCodes.NOT_FOUND)
          .send("GeoJSON layer does not exist");
      }

      const compiled = await compileTemplate("geojson", {
        group: id,
        layer: req.params.layer,
        base_url: getRequestHost(req),
      });

      return res.status(StatusCodes.OK).send(compiled);
    } catch (error) {
      printLog(
        "error",
        `Failed to serve GeoJSON group "${id}" - Layer "${req.params.layer}": ${error}`
      );

      return res
        .status(StatusCodes.INTERNAL_SERVER_ERROR)
        .send("Internal server error");
    }
  };
}

/**
 * Serve WMTS handler
 * @returns {(req: any, res: any, next: any) => Promise<any>}
 */
function serveWMTSHandler() {
  return async (req, res, next) => {
    const id = req.params.id;

    try {
      const item = config.repo.styles[id].rendered;

      if (item === undefined) {
        return res.status(StatusCodes.NOT_FOUND).send("WMTS does not exist");
      }

      const compiled = await compileTemplate("wmts", {
        id: id,
        name: item.tileJSON.name,
        base_url: getRequestHost(req),
      });

      res.header("content-type", "text/xml");

      return res.status(StatusCodes.OK).send(compiled);
    } catch (error) {
      printLog("error", `Failed to serve WMTS "${id}": ${error}`);

      return res
        .status(StatusCodes.INTERNAL_SERVER_ERROR)
        .send("Internal server error");
    }
  };
}

/**
 * Serve swagger handler
 * @returns {(req: any, res: any, next: any) => Promise<any>}
 */
function serveSwagger() {
  return (req, res, next) => {
    swaggerUi.setup(
      swaggerJsdoc({
        swaggerDefinition: {
          openapi: "3.0.0",
          info: {
            title: "Tile Server API",
            version: getVersion(),
            description: "API for tile server",
          },
        },
        servers: [
          {
            url: getRequestHost(req),
            description: "Tile server",
          },
        ],
        apis: ["src/*.js"],
      })
    )(req, res, next);
  };
}

/**
 * Get config.json/seed.json/cleanUp.json content handler
 * @returns {(req: any, res: any, next: any) => Promise<any>}
 */
function serveConfigHandler() {
  return async (req, res, next) => {
    try {
      let configJSON;

      if (req.query.type === "seed") {
        configJSON = await readSeedFile(false);
      } else if (req.query.type === "cleanUp") {
        configJSON = await readCleanUpFile(false);
      } else {
        configJSON = await readConfigFile(false);
      }

      res.header("content-type", "application/json");

      return res.status(StatusCodes.OK).send(configJSON);
    } catch (error) {
      printLog("error", `Failed to get config: ${error}`);

      return res
        .status(StatusCodes.INTERNAL_SERVER_ERROR)
        .send("Internal server error");
    }
  };
}

/**
 * Update config.json/seed.json/cleanUp.json content handler
 * @returns {(req: any, res: any, next: any) => Promise<any>}
 */
function serveConfigUpdateHandler() {
  return async (req, res, next) => {
    try {
      if (req.query.type === "seed") {
        try {
          validateJSON(await getJSONSchema("seed"), req.body);
        } catch (error) {
          return res
            .status(StatusCodes.BAD_REQUEST)
            .send(`Config element is invalid: ${error}`);
        }

        const config = await readSeedFile(false);

        if (req.body.styles === undefined) {
          printLog("info", "No styles to update in seed. Skipping...");
        } else {
          const ids = Object.keys(req.body.styles);

          printLog("info", `Updating ${ids.length} styles in seed...`);

          ids.map((id) => {
            config.styles[id] = req.body.styles[id];
          });
        }

        if (req.body.geojsons === undefined) {
          printLog("info", "No GeoJSONs to update in seed. Skipping...");
        } else {
          const ids = Object.keys(req.body.geojsons);

          printLog("info", `Updating ${ids.length} GeoJSONs in seed...`);

          ids.map((id) => {
            config.geojsons[id] = req.body.geojsons[id];
          });
        }

        if (req.body.datas === undefined) {
          printLog("info", "No datas to update in seed. Skipping...");
        } else {
          const ids = Object.keys(req.body.datas);

          printLog("info", `Updating ${ids.length} datas in seed...`);

          ids.map((id) => {
            config.datas[id] = req.body.datas[id];
          });
        }

        if (req.body.sprites === undefined) {
          printLog("info", "No sprites to update in seed. Skipping...");
        } else {
          const ids = Object.keys(req.body.sprites);

          printLog("info", `Updating ${ids.length} sprites in seed...`);

          ids.map((id) => {
            config.sprites[id] = req.body.sprites[id];
          });
        }

        if (req.body.fonts === undefined) {
          printLog("info", "No fonts to update in seed. Skipping...");
        } else {
          const ids = Object.keys(req.body.fonts);

          printLog("info", `Updating ${ids.length} fonts in seed...`);

          ids.map((id) => {
            config.fonts[id] = req.body.fonts[id];
          });
        }

        await updateSeedFile(config, 60000);
      } else if (req.query.type === "cleanUp") {
        try {
          validateJSON(await getJSONSchema("cleanup"), req.body);
        } catch (error) {
          return res
            .status(StatusCodes.BAD_REQUEST)
            .send(`Config element is invalid: ${error}`);
        }

        const config = await readCleanUpFile(false);

        if (req.body.styles === undefined) {
          printLog("info", "No styles to update in cleanup. Skipping...");
        } else {
          const ids = Object.keys(req.body.styles);

          printLog("info", `Updating ${ids.length} styles in cleanup...`);

          ids.map((id) => {
            config.styles[id] = req.body.styles[id];
          });
        }

        if (req.body.geojsons === undefined) {
          printLog("info", "No GeoJSONs to update in cleanup. Skipping...");
        } else {
          const ids = Object.keys(req.body.geojsons);

          printLog("info", `Updating ${ids.length} GeoJSONs in cleanup...`);

          ids.map((id) => {
            config.geojsons[id] = req.body.geojsons[id];
          });
        }

        if (req.body.datas === undefined) {
          printLog("info", "No datas to update in cleanup. Skipping...");
        } else {
          const ids = Object.keys(req.body.datas);

          printLog("info", `Updating ${ids.length} datas in cleanup...`);

          ids.map((id) => {
            config.datas[id] = req.body.datas[id];
          });
        }

        if (req.body.sprites === undefined) {
          printLog("info", "No sprites to update in cleanup. Skipping...");
        } else {
          const ids = Object.keys(req.body.sprites);

          printLog("info", `Updating ${ids.length} sprites in cleanup...`);

          ids.map((id) => {
            config.sprites[id] = req.body.sprites[id];
          });
        }

        if (req.body.fonts === undefined) {
          printLog("info", "No fonts to update in cleanup. Skipping...");
        } else {
          const ids = Object.keys(req.body.fonts);

          printLog("info", `Updating ${ids.length} fonts in cleanup...`);

          ids.map((id) => {
            config.fonts[id] = req.body.fonts[id];
          });
        }

        await updateCleanUpFile(config, 60000);
      } else {
        try {
          validateJSON(await getJSONSchema("config"), req.body);
        } catch (error) {
          return res
            .status(StatusCodes.BAD_REQUEST)
            .send(`Config element is invalid: ${error}`);
        }

        const config = await readConfigFile(false);

        if (req.body.styles === undefined) {
          printLog("info", "No styles to update in config. Skipping...");
        } else {
          const ids = Object.keys(req.body.styles);

          printLog("info", `Updating ${ids.length} styles in config...`);

          ids.map((id) => {
            config.styles[id] = req.body.styles[id];
          });
        }

        if (req.body.geojsons === undefined) {
          printLog(
            "info",
            "No GeoJSON groups to update in config. Skipping..."
          );
        } else {
          const ids = Object.keys(req.body.geojsons);

          printLog(
            "info",
            `Updating ${ids.length} GeoJSON groups in config...`
          );

          ids.map((id) => {
            config.geojsons[id] = req.body.geojsons[id];
          });
        }

        if (req.body.datas === undefined) {
          printLog("info", "No datas to update in config. Skipping...");
        } else {
          const ids = Object.keys(req.body.datas);

          printLog("info", `Updating ${ids.length} datas in config...`);

          ids.map((id) => {
            config.datas[id] = req.body.datas[id];
          });
        }

        if (req.body.sprites === undefined) {
          printLog("info", "No sprites to update in config. Skipping...");
        } else {
          const ids = Object.keys(req.body.sprites);

          printLog("info", `Updating ${ids.length} sprites in config...`);

          ids.map((id) => {
            config.sprites[id] = req.body.sprites[id];
          });
        }

        if (req.body.fonts === undefined) {
          printLog("info", "No fonts to update in config. Skipping...");
        } else {
          const ids = Object.keys(req.body.fonts);

          printLog("info", `Updating ${ids.length} fonts in config...`);

          ids.map((id) => {
            config.fonts[id] = req.body.fonts[id];
          });
        }

        await updateConfigFile(config, 60000);
      }

      if (req.query.restart === "true") {
        setTimeout(
          () =>
            process.send({
              action: "restartServer",
            }),
          0
        );
      }

      return res.status(StatusCodes.OK).send("OK");
    } catch (error) {
      printLog("error", `Failed to update config: ${error}`);

      return res
        .status(StatusCodes.INTERNAL_SERVER_ERROR)
        .send("Internal server error");
    }
  };
}

/**
 * Delete config.json/seed.json/cleanUp.json content handler
 * @returns {(req: any, res: any, next: any) => Promise<any>}
 */
function serveConfigDeleteHandler() {
  return async (req, res, next) => {
    try {
      try {
        validateJSON(await getJSONSchema("delete"), req.body);
      } catch (error) {
        return res
          .status(StatusCodes.BAD_REQUEST)
          .send(`Config element is invalid: ${error}`);
      }

      if (req.query.type === "seed") {
        const config = await readSeedFile(false);

        if (req.body.styles === undefined) {
          printLog("info", "No styles to remove in seed. Skipping...");
        } else {
          printLog(
            "info",
            `Removing ${req.body.styles.length} styles in seed...`
          );

          req.body.styles.map((id) => {
            delete config.styles[id];
          });
        }

        if (req.body.geojsons === undefined) {
          printLog("info", "No GeoJSONs to remove in seed. Skipping...");
        } else {
          printLog(
            "info",
            `Removing ${req.body.geojsons.length} GeoJSONs in seed...`
          );

          req.body.geojsons.map((id) => {
            delete config.geojsons[id];
          });
        }

        if (req.body.datas === undefined) {
          printLog("info", "No datas to remove in seed. Skipping...");
        } else {
          printLog(
            "info",
            `Removing ${req.body.datas.length} datas in seed...`
          );

          req.body.datas.map((id) => {
            delete config.datas[id];
          });
        }

        if (req.body.sprites === undefined) {
          printLog("info", "No sprites to remove in seed. Skipping...");
        } else {
          printLog(
            "info",
            `Removing ${req.body.sprites.length} sprites in seed...`
          );

          req.body.sprites.map((id) => {
            delete config.sprites[id];
          });
        }

        if (req.body.fonts === undefined) {
          printLog("info", "No fonts to remove in seed. Skipping...");
        } else {
          printLog(
            "info",
            `Removing ${req.body.fonts.length} fonts in seed...`
          );

          req.body.fonts.map((id) => {
            delete config.fonts[id];
          });
        }

        await updateSeedFile(config, 60000);
      } else if (req.query.type === "cleanUp") {
        const config = await readCleanUpFile(false);

        if (req.body.styles === undefined) {
          printLog("info", "No styles to remove in cleanup. Skipping...");
        } else {
          printLog(
            "info",
            `Removing ${req.body.styles.length} styles in cleanup...`
          );

          req.body.styles.map((id) => {
            delete config.styles[id];
          });
        }

        if (req.body.geojsons === undefined) {
          printLog("info", "No GeoJSONs to remove in cleanup. Skipping...");
        } else {
          printLog(
            "info",
            `Removing ${req.body.geojsons.length} GeoJSONs in cleanup...`
          );

          req.body.geojsons.map((id) => {
            delete config.geojsons[id];
          });
        }

        if (req.body.datas === undefined) {
          printLog("info", "No datas to remove in cleanup. Skipping...");
        } else {
          printLog(
            "info",
            `Removing ${req.body.datas.length} datas in cleanup...`
          );

          req.body.datas.map((id) => {
            delete config.datas[id];
          });
        }

        if (req.body.sprites === undefined) {
          printLog("info", "No sprites to remove in cleanup. Skipping...");
        } else {
          printLog(
            "info",
            `Removing ${req.body.sprites.length} sprites in cleanup...`
          );

          req.body.sprites.map((id) => {
            delete config.sprites[id];
          });
        }

        if (req.body.fonts === undefined) {
          printLog("info", "No fonts to remove in cleanup. Skipping...");
        } else {
          printLog(
            "info",
            `Removing ${req.body.fonts.length} fonts in cleanup...`
          );

          req.body.fonts.map((id) => {
            delete config.fonts[id];
          });
        }

        await updateCleanUpFile(config, 60000);
      } else {
        const config = await readConfigFile(false);

        if (req.body.styles === undefined) {
          printLog("info", "No styles to remove in cleanup. Skipping...");
        } else {
          printLog(
            "info",
            `Removing ${req.body.styles.length} styles in cleanup...`
          );

          req.body.styles.map((id) => {
            delete config.styles[id];
          });
        }

        if (req.body.geojsons === undefined) {
          printLog("info", "No GeoJSONs to remove in cleanup. Skipping...");
        } else {
          printLog(
            "info",
            `Removing ${req.body.geojsons.length} GeoJSONs in config...`
          );

          req.body.geojsons.map((id) => {
            delete config.geojsons[id];
          });
        }

        if (req.body.datas === undefined) {
          printLog("info", "No datas to remove in config. Skipping...");
        } else {
          printLog(
            "info",
            `Removing ${req.body.datas.length} datas in config...`
          );

          req.body.datas.map((id) => {
            delete config.datas[id];
          });
        }

        if (req.body.sprites === undefined) {
          printLog("info", "No sprites to remove in config. Skipping...");
        } else {
          printLog(
            "info",
            `Removing ${req.body.sprites.length} sprites in config...`
          );

          req.body.sprites.map((id) => {
            delete config.sprites[id];
          });
        }

        if (req.body.fonts === undefined) {
          printLog("info", "No fonts to remove in config. Skipping...");
        } else {
          printLog(
            "info",
            `Removing ${req.body.fonts.length} fonts in config...`
          );

          req.body.fonts.map((id) => {
            delete config.fonts[id];
          });
        }

        await updateConfigFile(config, 60000);
      }

      if (req.query.restart === "true") {
        setTimeout(
          () =>
            process.send({
              action: "restartServer",
            }),
          0
        );
      }

      return res.status(StatusCodes.OK).send("OK");
    } catch (error) {
      printLog("error", `Failed to delete config: ${error}`);

      return res
        .status(StatusCodes.INTERNAL_SERVER_ERROR)
        .send("Internal server error");
    }
  };
}

/**
 * Get summary handler
 * @returns {(req: any, res: any, next: any) => Promise<any>}
 */
function serveSummaryHandler() {
  return async (req, res, next) => {
    try {
      let result;

      if (req.query.type === "seed") {
        result = {
          styles: {},
          geojsons: {},
          datas: {},
          sprites: {},
          fonts: {},
        };

        await Promise.all([
          ...Object.keys(seed.styles || {}).map(async (id) => {
            if (
              (await isExistFolder(
                `${process.env.DATA_DIR}/caches/styles/${id}`
              )) === true
            ) {
              result.styles[id] = {
                actual: 1,
                expect: 1,
              };
            } else {
              result.styles[id] = {
                actual: 0,
                expect: 1,
              };
            }
          }),
          ...Object.keys(seed.geojsons || {}).map(async (id) => {
            if (
              (await isExistFolder(
                `${process.env.DATA_DIR}/caches/geojsons/${id}`
              )) === true
            ) {
              result.geojsons[id] = {
                actual: 1,
                expect: 1,
              };
            } else {
              result.geojsons[id] = {
                actual: 0,
                expect: 1,
              };
            }
          }),
          ...Object.keys(seed.datas || {}).map(async (id) => {
            const item = seed.datas[id];

            switch (item.storeType) {
              case "mbtiles": {
                try {
                  result.datas[id] = {
                    actual: await countMBTilesTiles(
                      `${process.env.DATA_DIR}/caches/mbtiles/${id}/${id}.mbtiles`
                    ),
                    expect: getTilesBoundsFromBBoxs(
                      item.bboxs,
                      item.zooms,
                      item.scheme
                    ).total,
                  };
                } catch (error) {
                  if (error.code !== "ENOENT") {
                    throw error;
                  } else {
                    result.datas[id] = {
                      actual: 0,
                      expect: getTilesBoundsFromBBoxs(
                        item.bboxs,
                        item.zooms,
                        item.scheme
                      ).total,
                    };
                  }
                }

                break;
              }

              case "xyz": {
                try {
                  result.datas[id] = {
                    actual: await countXYZTiles(
                      `${process.env.DATA_DIR}/caches/xyzs/${id}`
                    ),
                    expect: getTilesBoundsFromBBoxs(
                      item.bboxs,
                      item.zooms,
                      item.scheme
                    ).total,
                  };
                } catch (error) {
                  if (error.code !== "ENOENT") {
                    throw error;
                  } else {
                    result.datas[id] = {
                      actual: 0,
                      expect: getTilesBoundsFromBBoxs(
                        item.bboxs,
                        item.zooms,
                        item.scheme
                      ).total,
                    };
                  }
                }

                break;
              }

              case "pg": {
                result.datas[id] = {
                  actual: await countPostgreSQLTiles(
                    `${process.env.POSTGRESQL_BASE_URI}/${id}`
                  ),
                  expect: getTilesBoundsFromBBoxs(
                    item.bboxs,
                    item.zooms,
                    item.scheme
                  ).total,
                };

                break;
              }
            }
          }),
          ...Object.keys(seed.sprites || {}).map(async (id) => {
            if (
              (await isExistFolder(
                `${process.env.DATA_DIR}/caches/sprites/${id}`
              )) === true
            ) {
              result.sprites[id] = {
                actual: 1,
                expect: 1,
              };
            } else {
              result.sprites[id] = {
                actual: 0,
                expect: 1,
              };
            }
          }),
          ...Object.keys(seed.fonts || {}).map(async (id) => {
            if (
              (await isExistFolder(
                `${process.env.DATA_DIR}/caches/fonts/${id}`
              )) === true
            ) {
              result.fonts[id] = {
                actual: 1,
                expect: 1,
              };
            } else {
              result.fonts[id] = {
                actual: 0,
                expect: 1,
              };
            }
          }),
        ]);
      } else {
        result = {
          styles: {
            count: 0,
            size: 0,
            rendereds: {
              count: 0,
            },
          },
          geojsonGroups: {
            count: 0,
            geojsons: {
              count: 0,
              size: 0,
            },
          },
          datas: {
            count: 0,
            size: 0,
            mbtiles: {
              count: 0,
              size: 0,
            },
            pmtiles: {
              count: 0,
              size: 0,
            },
            xyzs: {
              count: 0,
              size: 0,
            },
            pgs: {
              count: 0,
              size: 0,
            },
          },
          sprites: {
            count: 0,
            size: 0,
          },
          fonts: {
            count: 0,
            size: 0,
          },
        };

        await Promise.all([
          ...Object.keys(config.repo.styles).map(async (id) => {
            const item = config.repo.styles[id];

            try {
              result.styles.size += await getStyleSize(item.path);
            } catch (error) {
              if (!(item.cache !== undefined && error.code === "ENOENT")) {
                throw error;
              }
            }

            result.styles.count += 1;

            // Rendereds info
            if (item.rendered !== undefined) {
              result.styles.rendereds.count += 1;
            }
          }),
          ...Object.keys(config.repo.geojsons).map(async (id) => {
            for (const layer in config.repo.geojsons[id]) {
              const item = config.repo.geojsons[id][layer];

              try {
                result.geojsonGroups.geojsons.size += await getGeoJSONSize(
                  item.path
                );
              } catch (error) {
                if (!(item.cache !== undefined && error.code === "ENOENT")) {
                  throw error;
                }
              }

              result.geojsonGroups.geojsons.count += 1;
            }

            result.geojsonGroups.count += 1;
          }),
          ...Object.keys(config.repo.datas).map(async (id) => {
            const item = config.repo.datas[id];

            switch (item.sourceType) {
              case "mbtiles": {
                try {
                  result.datas.mbtiles.size += await getMBTilesSize(item.path);
                } catch (error) {
                  if (!(item.cache !== undefined && error.code === "ENOENT")) {
                    throw error;
                  }
                }

                result.datas.mbtiles.count += 1;

                break;
              }

              case "pmtiles": {
                if (
                  item.path.startsWith("https://") !== true &&
                  item.path.startsWith("http://") !== true
                ) {
                  result.datas.pmtiles.size += await getPMTilesSize(item.path);
                }

                result.datas.pmtiles.count += 1;

                break;
              }

              case "xyz": {
                try {
                  result.datas.xyzs.size += await getXYZSize(item.path);
                } catch (error) {
                  if (!(item.cache !== undefined && error.code === "ENOENT")) {
                    throw error;
                  }
                }

                result.datas.xyzs.count += 1;

                break;
              }

              case "pg": {
                result.datas.pgs.size += await getPostgreSQLSize(
                  item.source,
                  id
                );
                result.datas.pgs.count += 1;

                break;
              }
            }
          }),
          ...Object.keys(config.repo.sprites).map(async (id) => {
            const item = config.repo.sprites[id];

            try {
              result.sprites.size += await getSpriteSize(item.path);
            } catch (error) {
              if (!(item.cache !== undefined && error.code === "ENOENT")) {
                throw error;
              }
            }

            result.sprites.count += 1;
          }),
          ...Object.keys(config.repo.fonts).map(async (id) => {
            const item = config.repo.fonts[id];

            try {
              result.fonts.size += await getFontSize(item.path);
            } catch (error) {
              if (!(item.cache !== undefined && error.code === "ENOENT")) {
                throw error;
              }
            }

            result.fonts.count += 1;
          }),
        ]);

        result.datas.count =
          result.datas.mbtiles.count +
          result.datas.pmtiles.count +
          result.datas.xyzs.count +
          result.datas.pgs.count;
        result.datas.size =
          result.datas.mbtiles.size +
          result.datas.pmtiles.size +
          result.datas.xyzs.size +
          result.datas.pgs.size;
      }

      res.header("content-type", "application/json");

      return res.status(StatusCodes.OK).send(result);
    } catch (error) {
      printLog("error", `Failed to get summary: ${error}`);

      return res
        .status(StatusCodes.INTERNAL_SERVER_ERROR)
        .send("Internal server error");
    }
  };
}

/**
 * Get health of server handler
 * @returns {(req: any, res: any, next: any) => Promise<any>}
 */
function serveHealthHandler() {
  return async (req, res, next) => {
    try {
      return res.status(StatusCodes.OK).send("OK");
    } catch (error) {
      printLog("error", `Failed to check health server: ${error}`);

      return res
        .status(StatusCodes.INTERNAL_SERVER_ERROR)
        .send("Internal server error");
    }
  };
}

/**
 * Restart/kill server handler
 * @returns {(req: any, res: any, next: any) => Promise<any>}
 */
function serveRestartKillHandler() {
  return async (req, res, next) => {
    try {
      if (req.query.type === "kill") {
        setTimeout(
          () =>
            process.send({
              action: "killServer",
            }),
          0
        );
      } else {
        setTimeout(
          () =>
            process.send({
              action: "restartServer",
            }),
          0
        );
      }

      return res.status(StatusCodes.OK).send("OK");
    } catch (error) {
      printLog("error", `Failed to restart/kill server: ${error}`);

      return res
        .status(StatusCodes.INTERNAL_SERVER_ERROR)
        .send("Internal server error");
    }
  };
}

/**
 * Calculate handler
 * @returns {(req: any, res: any, next: any) => Promise<any>}
 */
function calculateHandler() {
  return async (req, res, next) => {
    try {
      if (req.query.points) {
        const parsedPoints = JSON.parse(req.query.points);

        return res.status(StatusCodes.OK).send(getBBoxFromPoint(parsedPoints));
      } else if (req.query.circle) {
        const parsedCircle = JSON.parse(req.query.circle);

        return res
          .status(StatusCodes.OK)
          .send(getBBoxFromCircle(parsedCircle.center, parsedCircle.radius));
      } else {
        return res
          .status(StatusCodes.BAD_REQUEST)
          .send("points or circle query parameter is missing");
      }
    } catch (error) {
      printLog("error", `Failed to calculate bbox: ${error}`);

      if (error instanceof TypeError) {
        return res
          .status(StatusCodes.BAD_REQUEST)
          .send("points or circle query parameter is invalid");
      } else {
        return res
          .status(StatusCodes.INTERNAL_SERVER_ERROR)
          .send("Internal server error");
      }
    }
  };
}

export const serve_common = {
  init: () => {
    const app = express()
      .use("/", express.static("public/resources"))
      .disable("x-powered-by");

    if (process.env.SERVE_SWAGGER !== "false") {
      app.use("/swagger/index.html", swaggerUi.serve, serveSwagger());
    }

    /**
     * @swagger
     * tags:
     *   - name: Common
     *     description: Common related endpoints
     * /calculate-bbox:
     *   get:
     *     tags:
     *       - Common
     *     summary: Calculate bbox from points or circle
     *     parameters:
     *       - in: query
     *         name: circle
     *         schema:
     *           type: object
     *         required: false
     *         description: Circle params
     *       - in: query
     *         name: points
     *         schema:
     *           type: object
     *         required: false
     *         description: Points params
     *     responses:
     *       200:
     *         description: Bounding box
     *         content:
     *           text/plain:
     *             schema:
     *               type: string
     *               example: OK
     *       400:
     *         description: Invalid query params
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
    app.get("/calculate-bbox", calculateHandler());

    /**
     * @swagger
     * tags:
     *   - name: Common
     *     description: Common related endpoints
     * /summary:
     *   get:
     *     tags:
     *       - Common
     *     summary: Get summary
     *     parameters:
     *       - in: query
     *         name: type
     *         schema:
     *           type: string
     *           enum: [service, seed]
     *           example: service
     *         required: false
     *         description: Summary type
     *     responses:
     *       200:
     *         description: Summary
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
    app.get("/summary", checkReadyMiddleware(), serveSummaryHandler());

    /**
     * @swagger
     * tags:
     *   - name: Common
     *     description: Common related endpoints
     * /health:
     *   get:
     *     tags:
     *       - Common
     *     summary: Check health of the server
     *     responses:
     *       200:
     *         description: Server is healthy
     *         content:
     *           text/plain:
     *             schema:
     *               type: string
     *               example: OK
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
    app.get("/health", serveHealthHandler());

    /**
     * @swagger
     * tags:
     *   - name: Common
     *     description: Common related endpoints
     * /config:
     *   get:
     *     tags:
     *       - Common
     *     summary: Get config
     *     parameters:
     *       - in: query
     *         name: type
     *         schema:
     *           type: string
     *           enum: [config, seed, cleanUp]
     *           example: config
     *         required: false
     *         description: Config type
     *     responses:
     *       200:
     *         description: Config
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
     *   post:
     *     tags:
     *       - Common
     *     summary: Update config
     *     parameters:
     *       - in: query
     *         name: type
     *         schema:
     *           type: string
     *           enum: [config, seed, cleanUp]
     *           example: config
     *         required: false
     *         description: Config type
     *       - in: query
     *         name: restart
     *         schema:
     *           type: boolean
     *         required: false
     *         description: Restart server after change
     *     responses:
     *       200:
     *         description: Config is updated
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *       400:
     *         description: Bad request
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
     *   delete:
     *     tags:
     *       - Common
     *     summary: Update config
     *     parameters:
     *       - in: query
     *         name: type
     *         schema:
     *           type: string
     *           enum: [config, seed, cleanUp]
     *           example: config
     *         required: false
     *         description: Config type
     *       - in: query
     *         name: restart
     *         schema:
     *           type: boolean
     *         required: false
     *         description: Restart server after change
     *     responses:
     *       200:
     *         description: Config is updated
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *       400:
     *         description: Bad request
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
    app.get("/config", serveConfigHandler());
    app.post("/config", serveConfigUpdateHandler());
    app.delete("/config", serveConfigDeleteHandler());

    /**
     * @swagger
     * tags:
     *   - name: Common
     *     description: Common related endpoints
     * /restart:
     *   get:
     *     tags:
     *       - Common
     *     summary: Restart/kill the server
     *     parameters:
     *       - in: query
     *         name: type
     *         schema:
     *           type: string
     *           enum: [restart, kill]
     *           example: restart
     *         required: false
     *         description: Action type
     *     responses:
     *       200:
     *         description: Server will restart/kill
     *         content:
     *           text/plain:
     *             schema:
     *               type: string
     *               example: OK
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
    app.get("/restart", serveRestartKillHandler());

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
     *           example: id
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
    app.get("/styles/:id/wmts.xml", checkReadyMiddleware(), serveWMTSHandler());

    if (process.env.SERVE_FRONT_PAGE !== "false") {
      /**
       * @swagger
       * tags:
       *   - name: Common
       *     description: Common related endpoints
       * /styles/{id}/:
       *   get:
       *     tags:
       *       - Common
       *     summary: Serve style page
       *     parameters:
       *       - in: path
       *         name: id
       *         schema:
       *           type: string
       *           example: id
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
      app.get("/styles/:id/$", checkReadyMiddleware(), serveStyleHandler());

      /**
       * @swagger
       * tags:
       *   - name: Common
       *     description: Common related endpoints
       * /geojsons/{id}/:
       *   get:
       *     tags:
       *       - Common
       *     summary: Serve GeoJSON group page
       *     parameters:
       *       - in: path
       *         name: id
       *         schema:
       *           type: string
       *           example: id
       *         required: true
       *         description: ID of the GeoJSON group
       *     responses:
       *       200:
       *         description: GeoJSON group page
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
      app.get(
        "/geojsons/:id/$",
        checkReadyMiddleware(),
        serveGeoJSONGroupHandler()
      );

      /**
       * @swagger
       * tags:
       *   - name: Common
       *     description: Common related endpoints
       * /geojsons/{id}/{layer}:
       *   get:
       *     tags:
       *       - Common
       *     summary: Serve GeoJSON page
       *     parameters:
       *       - in: path
       *         name: id
       *         schema:
       *           type: string
       *           example: id
       *         required: true
       *         description: ID of the geojson
       *       - in: path
       *         name: layer
       *         schema:
       *           type: string
       *           example: layer
       *         required: true
       *         description: Layer of the GeoJSON
       *     responses:
       *       200:
       *         description: GeoJSON page
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
      app.get(
        "/geojsons/:id/:layer/$",
        checkReadyMiddleware(),
        serveGeoJSONHandler()
      );

      /* Serve data */
      /**
       * @swagger
       * tags:
       *   - name: Common
       *     description: Common related endpoints
       * /datas/{id}/:
       *   get:
       *     tags:
       *       - Common
       *     summary: Serve data page
       *     parameters:
       *       - in: path
       *         name: id
       *         schema:
       *           type: string
       *           example: id
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
       *   - name: Common
       *     description: Common related endpoints
       * /:
       *   get:
       *     tags:
       *       - Common
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
      app.get("/$", checkReadyMiddleware(), serveFrontPageHandler());
    }

    return app;
  },
};
