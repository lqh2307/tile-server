"use strict";

import { getPMTilesTile } from "./tile_pmtiles.js";
import mlgl from "@maplibre/maplibre-gl-native";
import { getSprite } from "./sprite.js";
import { printLog } from "./logger.js";
import { getFonts } from "./font.js";
import { config } from "./config.js";
import sharp from "sharp";
import {
  getPostgreSQLTileFromURL,
  cachePostgreSQLTileData,
  getPostgreSQLTile,
} from "./tile_postgresql.js";
import {
  getMBTilesTileFromURL,
  cacheMBtilesTileData,
  getMBTilesTile,
} from "./tile_mbtiles.js";
import {
  detectFormatAndHeaders,
  getLonLatFromXYZ,
  getDataFromURL,
  unzipAsync,
} from "./utils.js";
import {
  cacheXYZTileDataFile,
  getXYZTileFromURL,
  getXYZTile,
} from "./tile_xyz.js";

/**
 * Create empty data
 * @returns {object}
 */
export function createEmptyData() {
  return {
    gif: Buffer.from([
      0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00, 0x01, 0x00, 0x80, 0x00,
      0x00, 0x4c, 0x69, 0x71, 0x00, 0x00, 0x00, 0x21, 0xff, 0x0b, 0x4e, 0x45,
      0x54, 0x53, 0x43, 0x41, 0x50, 0x45, 0x32, 0x2e, 0x30, 0x03, 0x01, 0x00,
      0x00, 0x00, 0x21, 0xf9, 0x04, 0x05, 0x00, 0x00, 0x00, 0x00, 0x2c, 0x00,
      0x00, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0x02, 0x02, 0x44, 0x01,
      0x00, 0x3b,
    ]),
    png: Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
      0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
      0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00,
      0x09, 0x70, 0x48, 0x59, 0x73, 0x00, 0x00, 0x03, 0xe8, 0x00, 0x00, 0x03,
      0xe8, 0x01, 0xb5, 0x7b, 0x52, 0x6b, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x44,
      0x41, 0x54, 0x78, 0x9c, 0x63, 0x60, 0x60, 0x60, 0x60, 0x00, 0x00, 0x00,
      0x05, 0x00, 0x01, 0xa5, 0xf6, 0x45, 0x40, 0x00, 0x00, 0x00, 0x00, 0x49,
      0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
    ]),
    jpg: Buffer.from([
      0xff, 0xd8, 0xff, 0xdb, 0x00, 0x43, 0x00, 0x06, 0x04, 0x05, 0x06, 0x05,
      0x04, 0x06, 0x06, 0x05, 0x06, 0x07, 0x07, 0x06, 0x08, 0x0a, 0x10, 0x0a,
      0x0a, 0x09, 0x09, 0x0a, 0x14, 0x0e, 0x0f, 0x0c, 0x10, 0x17, 0x14, 0x18,
      0x18, 0x17, 0x14, 0x16, 0x16, 0x1a, 0x1d, 0x25, 0x1f, 0x1a, 0x1b, 0x23,
      0x1c, 0x16, 0x16, 0x20, 0x2c, 0x20, 0x23, 0x26, 0x27, 0x29, 0x2a, 0x29,
      0x19, 0x1f, 0x2d, 0x30, 0x2d, 0x28, 0x30, 0x25, 0x28, 0x29, 0x28, 0xff,
      0xdb, 0x00, 0x43, 0x01, 0x07, 0x07, 0x07, 0x0a, 0x08, 0x0a, 0x13, 0x0a,
      0x0a, 0x13, 0x28, 0x1a, 0x16, 0x1a, 0x28, 0x28, 0x28, 0x28, 0x28, 0x28,
      0x28, 0x28, 0x28, 0x28, 0x28, 0x28, 0x28, 0x28, 0x28, 0x28, 0x28, 0x28,
      0x28, 0x28, 0x28, 0x28, 0x28, 0x28, 0x28, 0x28, 0x28, 0x28, 0x28, 0x28,
      0x28, 0x28, 0x28, 0x28, 0x28, 0x28, 0x28, 0x28, 0x28, 0x28, 0x28, 0x28,
      0x28, 0x28, 0x28, 0x28, 0x28, 0x28, 0x28, 0x28, 0xff, 0xc0, 0x00, 0x11,
      0x08, 0x00, 0x01, 0x00, 0x01, 0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01,
      0x03, 0x11, 0x01, 0xff, 0xc4, 0x00, 0x15, 0x00, 0x01, 0x01, 0x00, 0x00,
      0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
      0x00, 0x08, 0xff, 0xc4, 0x00, 0x14, 0x10, 0x01, 0x00, 0x00, 0x00, 0x00,
      0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
      0xff, 0xc4, 0x00, 0x14, 0x01, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
      0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0xff, 0xc4,
      0x00, 0x14, 0x11, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
      0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0xff, 0xda, 0x00, 0x0c,
      0x03, 0x01, 0x00, 0x02, 0x11, 0x03, 0x11, 0x00, 0x3f, 0x00, 0x95, 0x00,
      0x07, 0xff, 0xd9,
    ]),
    jpeg: Buffer.from([
      0xff, 0xd8, 0xff, 0xdb, 0x00, 0x43, 0x00, 0x06, 0x04, 0x05, 0x06, 0x05,
      0x04, 0x06, 0x06, 0x05, 0x06, 0x07, 0x07, 0x06, 0x08, 0x0a, 0x10, 0x0a,
      0x0a, 0x09, 0x09, 0x0a, 0x14, 0x0e, 0x0f, 0x0c, 0x10, 0x17, 0x14, 0x18,
      0x18, 0x17, 0x14, 0x16, 0x16, 0x1a, 0x1d, 0x25, 0x1f, 0x1a, 0x1b, 0x23,
      0x1c, 0x16, 0x16, 0x20, 0x2c, 0x20, 0x23, 0x26, 0x27, 0x29, 0x2a, 0x29,
      0x19, 0x1f, 0x2d, 0x30, 0x2d, 0x28, 0x30, 0x25, 0x28, 0x29, 0x28, 0xff,
      0xdb, 0x00, 0x43, 0x01, 0x07, 0x07, 0x07, 0x0a, 0x08, 0x0a, 0x13, 0x0a,
      0x0a, 0x13, 0x28, 0x1a, 0x16, 0x1a, 0x28, 0x28, 0x28, 0x28, 0x28, 0x28,
      0x28, 0x28, 0x28, 0x28, 0x28, 0x28, 0x28, 0x28, 0x28, 0x28, 0x28, 0x28,
      0x28, 0x28, 0x28, 0x28, 0x28, 0x28, 0x28, 0x28, 0x28, 0x28, 0x28, 0x28,
      0x28, 0x28, 0x28, 0x28, 0x28, 0x28, 0x28, 0x28, 0x28, 0x28, 0x28, 0x28,
      0x28, 0x28, 0x28, 0x28, 0x28, 0x28, 0x28, 0x28, 0xff, 0xc0, 0x00, 0x11,
      0x08, 0x00, 0x01, 0x00, 0x01, 0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01,
      0x03, 0x11, 0x01, 0xff, 0xc4, 0x00, 0x15, 0x00, 0x01, 0x01, 0x00, 0x00,
      0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
      0x00, 0x08, 0xff, 0xc4, 0x00, 0x14, 0x10, 0x01, 0x00, 0x00, 0x00, 0x00,
      0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
      0xff, 0xc4, 0x00, 0x14, 0x01, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
      0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0xff, 0xc4,
      0x00, 0x14, 0x11, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
      0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0xff, 0xda, 0x00, 0x0c,
      0x03, 0x01, 0x00, 0x02, 0x11, 0x03, 0x11, 0x00, 0x3f, 0x00, 0x95, 0x00,
      0x07, 0xff, 0xd9,
    ]),
    webp: Buffer.from([
      0x52, 0x49, 0x46, 0x46, 0x40, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
      0x56, 0x50, 0x38, 0x58, 0x0a, 0x00, 0x00, 0x00, 0x10, 0x00, 0x00, 0x00,
      0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x41, 0x4c, 0x50, 0x48, 0x02, 0x00,
      0x00, 0x00, 0x00, 0x00, 0x56, 0x50, 0x38, 0x20, 0x18, 0x00, 0x00, 0x00,
      0x30, 0x01, 0x00, 0x9d, 0x01, 0x2a, 0x01, 0x00, 0x01, 0x00, 0x01, 0x40,
      0x26, 0x25, 0xa4, 0x00, 0x03, 0x70, 0x00, 0xfe, 0xfd, 0x36, 0x68, 0x00,
    ]),
    other: Buffer.from([]),
  };
}

/**
 * Render image
 * @param {object} rendered Rendered item object
 * @param {number} tileScale Tile scale
 * @param {256|512} tileSize Tile size
 * @param {number} z Zoom level
 * @param {number} x X tile index
 * @param {number} y Y tile index
 * @returns {Promise<Buffer>}
 */
export async function renderImage(rendered, tileScale, tileSize, z, x, y) {
  const renderer = await rendered.renderers[tileScale - 1].acquire();

  try {
    const data = await new Promise((resolve, reject) => {
      renderer.render(
        {
          zoom: z !== 0 && tileSize === 256 ? z - 1 : z,
          center: getLonLatFromXYZ(x, y, z, "center", "xyz"),
          width: z === 0 && tileSize === 256 ? 512 : tileSize,
          height: z === 0 && tileSize === 256 ? 512 : tileSize,
        },
        (error, data) => {
          rendered.renderers[tileScale - 1].release(renderer);

          if (error) {
            return reject(error);
          }

          resolve(data);
        }
      );
    });

    if (z === 0 && tileSize === 256) {
      // HACK2: This hack allows tile-server to support zoom level 0 - 256px tiles, which would actually be zoom -1 in maplibre-gl-native
      return await sharp(data, {
        raw: {
          premultiplied: true,
          width: 512 * tileScale,
          height: 512 * tileScale,
          channels: 4,
        },
      })
        .resize({
          width: 256 * tileScale,
          height: 256 * tileScale,
        })
        .png({
          compressionLevel: rendered.compressionLevel,
        })
        .toBuffer();
      // END HACK2
    } else {
      return await sharp(data, {
        raw: {
          premultiplied: true,
          width: tileSize * tileScale,
          height: tileSize * tileScale,
          channels: 4,
        },
      })
        .png({
          compressionLevel: rendered.compressionLevel,
        })
        .toBuffer();
    }
  } catch (error) {
    if (renderer !== undefined) {
      rendered.renderers[tileScale - 1].release(renderer);
    }

    throw error;
  }
}

/**
 * Check if PNG image file/buffer is full transparent (alpha = 0)
 * @param {Buffer} buffer Buffer of the PNG image
 * @returns {Promise<boolean>}
 */
export async function isFullTransparentPNGImage(buffer) {
  try {
    if (
      buffer[0] !== 0x89 ||
      buffer[1] !== 0x50 ||
      buffer[2] !== 0x4e ||
      buffer[3] !== 0x47 ||
      buffer[4] !== 0x0d ||
      buffer[5] !== 0x0a ||
      buffer[6] !== 0x1a ||
      buffer[7] !== 0x0a
    ) {
      return false;
    }

    const { data, info } = await sharp(buffer).raw().toBuffer({
      resolveWithObject: true,
    });

    if (info.channels !== 4) {
      return false;
    }

    for (let i = 3; i < data.length; i += 4) {
      if (data[i] !== 0) {
        return false;
      }
    }

    return true;
  } catch (error) {
    return false;
  }
}

/**
 * Create a renderer
 * @param {number} ratio Scale ratio
 * @param {object} emptyDatas Placeholder data for empty tiles
 * @param {string} styleJSON Style JSON for the renderer
 * @returns {mlgl.Map} Renderer instance
 */
export function createRenderer(ratio, emptyDatas, styleJSON) {
  const renderer = new mlgl.Map({
    mode: "tile",
    ratio: ratio,
    request: async (req, callback) => {
      const url = decodeURIComponent(req.url);
      const parts = url.split("/");

      if (parts[0] === "sprites:") {
        try {
          /* Get sprite */
          const data = await getSprite(parts[2], parts[3]);

          callback(null, {
            data: data,
          });
        } catch (error) {
          printLog(
            "warning",
            `Failed to get sprite "${parts[2]}" - File "${parts[3]}": ${error}. Serving empty sprite...`
          );

          callback(error, {
            data: null,
          });
        }
      } else if (parts[0] === "fonts:") {
        try {
          /* Get font */
          let data = await getFonts(parts[2], parts[3]);

          /* Unzip pbf font */
          const headers = detectFormatAndHeaders(data).headers;

          if (
            headers["content-type"] === "application/x-protobuf" &&
            headers["content-encoding"] !== undefined
          ) {
            data = await unzipAsync(data);
          }

          callback(null, {
            data: data,
          });
        } catch (error) {
          printLog(
            "warning",
            `Failed to get font "${parts[2]}" - File "${parts[3]}": ${error}. Serving empty font...`
          );

          callback(error, {
            data: null,
          });
        }
      } else if (parts[0] === "pmtiles:") {
        const z = Number(parts[3]);
        const x = Number(parts[4]);
        const y = Number(parts[5].slice(0, parts[5].indexOf(".")));
        const tileName = `${z}/${x}/${y}`;
        const sourceData = config.repo.datas[parts[2]];

        try {
          /* Get rendered tile */
          const dataTile = await getPMTilesTile(sourceData.source, z, x, y);

          /* Unzip pbf rendered tile */
          if (
            dataTile.headers["content-type"] === "application/x-protobuf" &&
            dataTile.headers["content-encoding"] !== undefined
          ) {
            dataTile.data = await unzipAsync(dataTile.data);
          }

          callback(null, {
            data: dataTile.data,
          });
        } catch (error) {
          printLog(
            "warning",
            `Failed to get data "${parts[2]}" - Tile "${tileName}": ${error}. Serving empty tile...`
          );

          callback(null, {
            data: emptyDatas[sourceData.tileJSON.format] || emptyDatas.other,
          });
        }
      } else if (parts[0] === "mbtiles:") {
        const z = Number(parts[3]);
        const x = Number(parts[4]);
        const y = Number(parts[5].slice(0, parts[5].indexOf(".")));
        const tileName = `${z}/${x}/${y}`;
        const sourceData = config.repo.datas[parts[2]];

        try {
          /* Get rendered tile */
          let dataTile;

          try {
            dataTile = await getMBTilesTile(sourceData.source, z, x, y);
          } catch (error) {
            if (
              sourceData.sourceURL !== undefined &&
              error.message === "Tile does not exist"
            ) {
              const url = sourceData.sourceURL.replaceAll(
                "{z}/{x}/{y}",
                tileName
              );

              printLog(
                "info",
                `Forwarding data "${id}" - Tile "${tileName}" - To "${url}"...`
              );

              /* Get data */
              dataTile = await getMBTilesTileFromURL(
                url,
                60000 // 1 mins
              );

              /* Cache */
              if (sourceData.storeCache === true) {
                cacheMBtilesTileData(
                  sourceData.source,
                  z,
                  x,
                  y,
                  dataTile.data,
                  sourceData.storeMD5,
                  sourceData.storeTransparent
                );
              }
            } else {
              throw error;
            }
          }

          /* Unzip pbf rendered tile */
          if (
            dataTile.headers["content-type"] === "application/x-protobuf" &&
            dataTile.headers["content-encoding"] !== undefined
          ) {
            dataTile.data = await unzipAsync(dataTile.data);
          }

          callback(null, {
            data: dataTile.data,
          });
        } catch (error) {
          printLog(
            "warning",
            `Failed to get data "${parts[2]}" - Tile "${tileName}": ${error}. Serving empty tile...`
          );

          callback(null, {
            data: emptyDatas[sourceData.tileJSON.format] || emptyDatas.other,
          });
        }
      } else if (parts[0] === "xyz:") {
        const z = Number(parts[3]);
        const x = Number(parts[4]);
        const y = Number(parts[5].slice(0, parts[5].indexOf(".")));
        const tileName = `${z}/${x}/${y}`;
        const sourceData = config.repo.datas[parts[2]];

        try {
          /* Get rendered tile */
          let dataTile;

          try {
            dataTile = await getXYZTile(
              sourceData.source,
              z,
              x,
              y,
              sourceData.tileJSON.format
            );
          } catch (error) {
            if (
              sourceData.sourceURL !== undefined &&
              error.message === "Tile does not exist"
            ) {
              const url = sourceData.sourceURL.replaceAll(
                "{z}/{x}/{y}",
                tileName
              );

              printLog(
                "info",
                `Forwarding data "${id}" - Tile "${tileName}" - To "${url}"...`
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
                  sourceData.md5Source,
                  z,
                  x,
                  y,
                  sourceData.tileJSON.format,
                  dataTile.data,
                  sourceData.storeMD5,
                  sourceData.storeTransparent
                );
              }
            } else {
              throw error;
            }
          }

          /* Unzip pbf rendered tile */
          if (
            dataTile.headers["content-type"] === "application/x-protobuf" &&
            dataTile.headers["content-encoding"] !== undefined
          ) {
            dataTile.data = await unzipAsync(dataTile.data);
          }

          callback(null, {
            data: dataTile.data,
          });
        } catch (error) {
          printLog(
            "warning",
            `Failed to get data "${parts[2]}" - Tile "${tileName}": ${error}. Serving empty tile...`
          );

          callback(null, {
            data: emptyDatas[sourceData.tileJSON.format] || emptyDatas.other,
          });
        }
      } else if (parts[0] === "pg:") {
        const z = Number(parts[3]);
        const x = Number(parts[4]);
        const y = Number(parts[5].slice(0, parts[5].indexOf(".")));
        const tileName = `${z}/${x}/${y}`;
        const sourceData = config.repo.datas[parts[2]];

        try {
          /* Get rendered tile */
          let dataTile;

          try {
            dataTile = await getPostgreSQLTile(sourceData.source, z, x, y);
          } catch (error) {
            if (
              sourceData.sourceURL !== undefined &&
              error.message === "Tile does not exist"
            ) {
              const url = sourceData.sourceURL.replaceAll(
                "{z}/{x}/{y}",
                tileName
              );

              printLog(
                "info",
                `Forwarding data "${id}" - Tile "${tileName}" - To "${url}"...`
              );

              /* Get data */
              dataTile = await getPostgreSQLTileFromURL(
                url,
                60000 // 1 mins
              );

              /* Cache */
              if (sourceData.storeCache === true) {
                cachePostgreSQLTileData(
                  sourceData.source,
                  z,
                  x,
                  y,
                  dataTile.data,
                  sourceData.storeMD5,
                  sourceData.storeTransparent
                );
              }
            } else {
              throw error;
            }
          }

          /* Unzip pbf rendered tile */
          if (
            dataTile.headers["content-type"] === "application/x-protobuf" &&
            dataTile.headers["content-encoding"] !== undefined
          ) {
            dataTile.data = await unzipAsync(dataTile.data);
          }

          callback(null, {
            data: dataTile.data,
          });
        } catch (error) {
          printLog(
            "warning",
            `Failed to get data "${parts[2]}" - Tile "${tileName}": ${error}. Serving empty tile...`
          );

          callback(null, {
            data: emptyDatas[sourceData.tileJSON.format] || emptyDatas.other,
          });
        }
      } else if (parts[0] === "http:" || parts[0] === "https:") {
        try {
          printLog("info", `Getting data tile from "${url}"...`);

          const dataTile = await getDataFromURL(
            url,
            60000, // 1 mins,
            "arraybuffer"
          );

          /* Unzip pbf data */
          const headers = detectFormatAndHeaders(dataTile.data).headers;

          if (
            headers["content-type"] === "application/x-protobuf" &&
            headers["content-encoding"] !== undefined
          ) {
            dataTile.data = await unzipAsync(dataTile.data);
          }

          callback(null, {
            data: dataTile.data,
          });
        } catch (error) {
          printLog(
            "warning",
            `Failed to get data tile from "${url}": ${error}. Serving empty tile...`
          );

          callback(null, {
            data:
              emptyDatas[url.slice(url.lastIndexOf(".") + 1)] ||
              emptyDatas.other,
          });
        }
      }
    },
  });

  renderer.load(styleJSON);

  return renderer;
}

/**
 * Destroy a renderer
 * @param {mlgl.Map} renderer Renderer instance
 * @returns {void}
 */
export function destroyRenderer(renderer) {
  renderer.release();
}
