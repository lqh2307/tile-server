"use strict";

import { validateStyleMin } from "@maplibre/maplibre-gl-style-spec";
import { StatusCodes } from "http-status-codes";
import fsPromise from "node:fs/promises";
import protobuf from "protocol-buffers";
import { config } from "./config.js";
import handlebars from "handlebars";
import https from "node:https";
import path from "node:path";
import http from "node:http";
import crypto from "crypto";
import axios from "axios";
import sharp from "sharp";
import fs from "node:fs";
import zlib from "zlib";
import util from "util";
import Ajv from "ajv";

const glyphsProto = protobuf(fs.readFileSync("public/protos/glyphs.proto"));
const vectorTileProto = protobuf(
  fs.readFileSync("public/protos/vector_tile.proto")
);

/**
 * Combine any number of glyph (SDF) PBFs
 * Returns a re-encoded PBF with the combined
 * font faces, composited using array order
 * to determine glyph priority
 * @param {array} buffers An array of SDF PBFs
 * @param {string} fontstack
 */
function combinePBFFonts(buffers, fontstack) {
  let result;
  const coverage = {};

  for (const buffer of buffers) {
    const decoded = glyphsProto.glyphs.decode(buffer);
    const glyphs = decoded.stacks[0].glyphs;

    if (result === undefined) {
      for (const glyph of glyphs) {
        coverage[glyph.id] = true;
      }

      result = decoded;
    } else {
      for (const glyph of glyphs) {
        if (!coverage[glyph.id]) {
          result.stacks[0].glyphs.push(glyph);
          coverage[glyph.id] = true;
        }
      }

      result.stacks[0].name += ", " + decoded.stacks[0].name;
    }
  }

  if (fontstack !== undefined) {
    result.stacks[0].name = fontstack;
  }

  result.stacks[0].glyphs.sort((a, b) => a.id - b.id);

  return glyphsProto.glyphs.encode(result);
}

/**
 * Extracts layer names from a vector tile PBF buffer
 * @param {Buffer} pbfData - The PBF data buffer
 * @returns {Promise<Array<string>} - A promise that resolves to an array of layer names
 */
export async function getLayerNamesFromPBFTileBuffer(pbfData) {
  const decoded = vectorTileProto.tile.decode(pbfData);

  return decoded.layers.map((layer) => layer.name);
}

/**
 * Get data tile from a URL
 * @param {string} url The URL to fetch data from
 * @param {number} timeout Timeout in milliseconds
 * @returns {Promise<object>}
 */
export async function getDataTileFromURL(url, timeout) {
  try {
    const response = await axios.get(url, {
      timeout: timeout,
      responseType: "arraybuffer",
      headers: {
        "User-Agent": "Tile Server",
      },
      validateStatus: (status) => {
        return status === StatusCodes.OK;
      },
      httpAgent: new http.Agent({
        keepAlive: false,
      }),
      httpsAgent: new https.Agent({
        keepAlive: false,
      }),
    });

    return {
      data: response.data,
      headers: detectFormatAndHeaders(response.data).headers,
    };
  } catch (error) {
    if (error.response) {
      if (
        error.response.status === StatusCodes.NOT_FOUND ||
        error.response.status === StatusCodes.NO_CONTENT
      ) {
        throw new Error("Tile does not exist");
      }

      throw new Error(
        `Failed to request "${url}" with status code: ${error.response.status} - ${error.response.statusText}`
      );
    }

    throw new Error(`Failed to request "${url}": ${error.message}`);
  }
}

/**
 * Get data from a URL
 * @param {string} url The URL to fetch data from
 * @param {number} timeout Timeout in milliseconds
 * @returns {Promise<object>}
 */
export async function getData(url, timeout) {
  try {
    const response = await axios.get(url, {
      timeout: timeout,
      responseType: "arraybuffer",
      headers: {
        "User-Agent": "Tile Server",
      },
      httpAgent: new http.Agent({
        keepAlive: false,
      }),
      httpsAgent: new https.Agent({
        keepAlive: false,
      }),
    });

    return response;
  } catch (error) {
    if (error.response) {
      throw new Error(
        `Status code: ${error.response.status} - ${error.response.statusText}`
      );
    }

    throw error;
  }
}

/**
 * Check ready middleware
 * @returns {void}
 */
export function checkReadyMiddleware() {
  return async (req, res, next) => {
    try {
      if (config.startupComplete === false) {
        return res.status(StatusCodes.SERVICE_UNAVAILABLE).send("Starting...");
      }

      next();
    } catch (error) {
      printLog("error", `Failed to check ready server: ${error}`);

      return res
        .status(StatusCodes.INTERNAL_SERVER_ERROR)
        .send("Internal server error");
    }
  };
}

/**
 * Get xyz tile indices from longitude, latitude, and zoom level (tile size = 256)
 * @param {number} lon Longitude in EPSG:4326
 * @param {number} lat Latitude in EPSG:4326
 * @param {number} z Zoom level
 * @param {"xyz"|"tms"} scheme Tile scheme
 * @returns {Array<number>} Tile indices [x, y, z]
 */
export function getXYZFromLonLatZ(lon, lat, z, scheme = "xyz") {
  const size = 256 * Math.pow(2, z);
  const bc = size / 360;
  const cc = size / (2 * Math.PI);
  const zc = size / 2;
  const maxTileIndex = Math.pow(2, z) - 1;

  if (lon > 180) {
    lon = 180;
  } else if (lon < -180) {
    lon = -180;
  }

  const px = zc + lon * bc;
  let x = Math.floor(px / 256);
  if (x < 0) {
    x = 0;
  } else if (x > maxTileIndex) {
    x = maxTileIndex;
  }

  if (lat > 85.051129) {
    lat = 85.051129;
  } else if (lat < -85.051129) {
    lat = -85.051129;
  }

  let py = zc - cc * Math.log(Math.tan(Math.PI / 4 + lat * (Math.PI / 360)));
  if (scheme === "tms") {
    py = size - py;
  }

  let y = Math.floor(py / 256);
  if (y < 0) {
    y = 0;
  } else if (y > maxTileIndex) {
    y = maxTileIndex;
  }

  return [x, y, z];
}

/**
 * Get longitude, latitude from tile indices x, y, and zoom level (tile size = 256)
 * @param {number} x X tile index
 * @param {number} y Y tile index
 * @param {number} z Zoom level
 * @param {"center"|"topLeft"|"bottomRight"} position Tile position: "center", "topLeft", or "bottomRight"
 * @param {"xyz"|"tms"} scheme Tile scheme
 * @returns {Array<number>} [longitude, latitude] in EPSG:4326
 */
export function getLonLatFromXYZ(
  x,
  y,
  z,
  position = "topLeft",
  scheme = "xyz"
) {
  const size = 256 * Math.pow(2, z);
  const bc = size / 360;
  const cc = size / (2 * Math.PI);
  const zc = size / 2;

  let px = x * 256;
  let py = y * 256;

  if (position === "center") {
    px = (x + 0.5) * 256;
    py = (y + 0.5) * 256;
  } else if (position === "bottomRight") {
    px = (x + 1) * 256;
    py = (y + 1) * 256;
  }

  if (scheme === "tms") {
    py = size - py;
  }

  return [
    (px - zc) / bc,
    (360 / Math.PI) * (Math.atan(Math.exp((zc - py) / cc)) - Math.PI / 4),
  ];
}

/**
 * Get tile bounds for specific zoom levels intersecting a bounding box
 * @param {Array<number>} bbox [west, south, east, north] in EPSG:4326
 * @param {Array<number>} zooms Array of specific zoom levels
 * @param {"xyz"|"tms"} scheme Tile scheme
 * @returns {Object} Object with keys as zoom levels and values as {x: [min, max], y: [min, max]}
 */
export function getTileBoundsFromBBox(bbox, zooms, scheme) {
  const tilesSummary = {};

  for (const zoom of zooms) {
    const [xMin, yMin] = getXYZFromLonLatZ(bbox[0], bbox[3], zoom, scheme);
    const [xMax, yMax] = getXYZFromLonLatZ(bbox[2], bbox[1], zoom, scheme);

    tilesSummary[`${zoom}`] = {
      x: [xMin, xMax],
      y: [yMin, yMax],
    };
  }

  return tilesSummary;
}

/**
 * Convert tile indices to a bounding box that intersects the outer tiles
 * @param {number} xMin Minimum x tile index
 * @param {number} yMin Minimum y tile index
 * @param {number} xMax Maximum x tile index
 * @param {number} yMax Maximum y tile index
 * @param {number} z Zoom level
 * @param {"xyz"|"tms"} scheme Tile scheme
 * @returns {Array<number>} Bounding box [lonMin, latMin, lonMax, latMax] in EPSG:4326
 */
export function getBBoxFromTiles(xMin, yMin, xMax, yMax, z, scheme = "xyz") {
  const [lonMin, latMax] = getLonLatFromXYZ(xMin, yMin, z, "topLeft", scheme);
  const [lonMax, latMin] = getLonLatFromXYZ(
    xMax,
    yMax,
    z,
    "bottomRight",
    z,
    scheme
  );

  return [lonMin, latMin, lonMax, latMax];
}

/**
 * Delay function to wait for a specified time
 * @param {number} ms Time to wait in milliseconds
 * @returns {Promise<void>}
 */
export function delay(ms) {
  if (ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

/**
 * Attempt do function multiple times
 * @param {function} fn The function to attempt
 * @param {number} maxTry The number of maxTry allowed
 * @param {number} after Delay in milliseconds between each retry
 * @returns {Promise<void>}
 */
export async function retry(fn, maxTry, after = 0) {
  for (let attempt = 1; attempt <= maxTry; attempt++) {
    try {
      return await fn();
    } catch (error) {
      const remainingAttempts = maxTry - attempt;
      if (remainingAttempts > 0) {
        printLog(
          "warning",
          `${error}. ${remainingAttempts} tries remaining - After ${after} ms...`
        );

        await delay(after);
      } else {
        throw error;
      }
    }
  }
}

/**
 * Recursively removes empty folders in a directory
 * @param {string} folderPath The root directory to check for empty folders
 * @returns {Promise<void>}
 */
export async function removeEmptyFolders(folderPath) {
  const entries = await fsPromise.readdir(folderPath, {
    withFileTypes: true,
  });

  if (entries.length === 0) {
    await fsPromise.rm(folderPath, {
      force: true,
      recursive: true,
    });

    return;
  }

  await Promise.all(
    entries.map(async (entry) => {
      const fullPath = `${folderPath}/${entry.name}`;

      if (entry.isDirectory() === true) {
        await removeEmptyFolders(fullPath);
      }
    })
  );
}

/**
 * Recursively removes old cache locks
 * @param {string} folderPath The root directory to removes old cache locks
 * @returns {Promise<void>}
 */
export async function removeOldCacheLocks(folderPath) {
  const fileNames = await findFiles(folderPath, /^.*\.lock$/, true);

  await Promise.all(
    fileNames.map(async (fileName) => {
      const lockFilePath = `${folderPath}/${fileName}`;
      const tempFilePath = `${lockFilePath.slice(
        0,
        lockFilePath.lastIndexOf(".")
      )}.tmp`;

      await removeFilesOrFolder(tempFilePath);
      await removeFilesOrFolder(lockFilePath);
    })
  );
}

/**
 * Compile template
 * @param {string} template
 * @param {object} data
 * @returns {Promise<string>}
 */
export async function compileTemplate(template, data) {
  const fileData = await fsPromise.readFile(
    `public/templates/${template}.tmpl`,
    "utf8"
  );

  return handlebars.compile(fileData)(data);
}

/**
 * Render data
 * @param {object} item
 * @param {number} scale
 * @param {256|512} tileSize
 * @param {number} x X tile index
 * @param {number} y Y tile index
 * @param {number} z Zoom level
 * @param {"xyz"|"tms"} scheme
 * @returns {Promise<Buffer>}
 */
export async function renderData(
  item,
  scale,
  tileSize,
  x,
  y,
  z,
  scheme = "xyz"
) {
  const params = {
    zoom: z,
    center: getLonLatFromXYZ(x, y, z, "center", scheme),
    width: tileSize,
    height: tileSize,
  };

  if (tileSize === 256) {
    if (z !== 0) {
      params.zoom = z - 1;
    } else {
      // HACK1: This hack allows tile-server to support zoom level 0 - 256px tiles, which would actually be zoom -1 in maplibre-gl-native
      params.width = 512;
      params.height = 512;
      // END HACK1
    }
  }

  const renderer = await item.renderers[scale - 1].acquire();

  return new Promise((resolve, reject) => {
    renderer.render(params, (error, data) => {
      item.renderers[scale - 1].release(renderer);

      if (error) {
        return reject(error);
      }

      resolve(data);
    });
  });
}

/**
 * Render image
 * @param {object} data
 * @param {number} scale
 * @param {number} compression
 * @param {256|512} tileSize
 * @param {number} z Zoom level
 * @returns {Promise<Buffer>}
 */
export async function processImage(data, scale, compression, tileSize, z) {
  if (z === 0 && tileSize === 256) {
    // HACK2: This hack allows tile-server to support zoom level 0 - 256px tiles, which would actually be zoom -1 in maplibre-gl-native
    return await sharp(data, {
      raw: {
        premultiplied: true,
        width: 512 * scale,
        height: 512 * scale,
        channels: 4,
      },
    })
      .resize({
        width: 256 * scale,
        height: 256 * scale,
      })
      .png({
        compressionLevel: compression,
      })
      .toBuffer();
    // END HACK2
  } else {
    return await sharp(data, {
      raw: {
        premultiplied: true,
        width: tileSize * scale,
        height: tileSize * scale,
        channels: 4,
      },
    })
      .png({
        compressionLevel: compression,
      })
      .toBuffer();
  }
}

/**
 * Check folder is exist?
 * @param {string} dirPath
 * @returns {Promise<boolean>}
 */
export async function isExistFolder(dirPath) {
  try {
    const stat = await fsPromise.stat(dirPath);

    return stat.isDirectory();
  } catch (error) {
    return false;
  }
}

/**
 * Check file is exist?
 * @param {string} filePath
 * @returns {Promise<boolean>}
 */
export async function isExistFile(filePath) {
  try {
    const stat = await fsPromise.stat(filePath);

    return stat.isFile();
  } catch (error) {
    return false;
  }
}

/**
 * Find matching files in a directory
 * @param {string} dirPath The directory path to search
 * @param {RegExp} regex The regex to match files
 * @param {boolean} recurse Whether to search recursively in subdirectories
 * @returns {Promise<string>} Array of file paths matching the regex
 */
export async function findFiles(dirPath, regex, recurse = false) {
  const entries = await fsPromise.readdir(dirPath, {
    withFileTypes: true,
  });

  const results = [];

  for (const entry of entries) {
    if (entry.isFile() === true && regex.test(entry.name) === true) {
      results.push(entry.name);
    } else if (entry.isDirectory() === true && recurse === true) {
      const fileNames = await findFiles(
        `${dirPath}/${entry.name}`,
        regex,
        recurse
      );

      results.push(...fileNames.map((fileName) => `${entry.name}/${fileName}`));
    }
  }

  return results;
}

/**
 * Find matching folders in a directory
 * @param {string} dirPath The directory path to search
 * @param {RegExp} regex The regex to match folders
 * @param {boolean} recurse Whether to search recursively in subdirectories
 * @returns {Promise<string>} Array of folder paths matching the regex
 */
export async function findFolders(dirPath, regex, recurse = false) {
  const entries = await fsPromise.readdir(dirPath, {
    withFileTypes: true,
  });

  const results = [];

  for (const entry of entries) {
    if (entry.isDirectory() === true) {
      if (regex.test(entry.name) === true) {
        results.push(entry.name);
      }

      if (recurse === true) {
        const directoryNames = await findFolders(
          `${dirPath}/${entry.name}`,
          regex,
          recurse
        );

        results.push(
          ...directoryNames.map(
            (directoryName) => `${entry.name}/${directoryName}`
          )
        );
      }
    }
  }

  return results;
}

/**
 * Remove files or folders
 * @param {Array<string>} fileOrFolders File or folder paths
 * @returns {Promise<void>}
 */
export async function removeFilesOrFolders(fileOrFolders) {
  await Promise.all(
    fileOrFolders.map((fileOrFolder) =>
      fsPromise.rm(fileOrFolder, {
        force: true,
        recursive: true,
      })
    )
  );
}

/**
 * Remove file or folder
 * @param {string} fileOrFolder File or folder path
 * @returns {Promise<void>}
 */
export async function removeFilesOrFolder(fileOrFolder) {
  fsPromise.rm(fileOrFolder, {
    force: true,
    recursive: true,
  });
}

/**
 * Get request host
 * @param {Request} req
 * @returns {string}
 */
export function getRequestHost(req) {
  return `${req.protocol}://${req.headers.host}/`;
}

/**
 * Get fonts pbf
 * @param {string} ids
 * @param {string} fileName
 * @returns {Promise<Buffer>}
 */
export async function getFontsPBF(ids, fileName) {
  const data = await Promise.all(
    ids.split(",").map(async (font) => {
      try {
        /* Check font is exist? */
        if (config.repo.fonts[font] === undefined) {
          throw new Error("Font is not found");
        }

        return await fsPromise.readFile(
          `${config.paths.fonts}/${font}/${fileName}`
        );
      } catch (error) {
        printLog(
          "warning",
          `Failed to get font "${font}": ${error}. Using fallback font "${config.fallbackFont}"...`
        );

        return await fsPromise.readFile(
          `public/resources/fonts/${config.fallbackFont}/${fileName}`
        );
      }
    })
  );

  return combinePBFFonts(data);
}

/**
 * Get sprite
 * @param {string} id
 * @param {string} fileName
 * @returns {Promise<Buffer>}
 */
export async function getSprite(id, fileName) {
  return await fsPromise.readFile(`${config.paths.sprites}/${id}/${fileName}`);
}

/**
 * Print log to console
 * @param {"info"|"warning"|"error"} level
 * @param {string} msg
 * @returns {void}
 */
export function printLog(level, msg) {
  if (level === "warning") {
    console.warn(
      `[PID = ${process.pid}] ${new Date().toISOString()} [WARNING] ${msg}`
    );
  } else if (level === "error") {
    console.error(
      `[PID = ${process.pid}] ${new Date().toISOString()} [ERROR] ${msg}`
    );
  } else {
    console.info(
      `[PID = ${process.pid}] ${new Date().toISOString()} [INFO] ${msg}`
    );
  }
}

/**
 * Validate font
 * @param {string} pbfDirPath
 * @returns {Promise<void>}
 */
export async function validateFont(pbfDirPath) {
  const pbfFileNames = await findFiles(pbfDirPath, /^\d{1,5}-\d{1,5}\.pbf$/);

  if (pbfFileNames.length === 0) {
    throw new Error("Missing some PBF files");
  }
}

/**
 * Validate data info (no validate json field)
 * @param {object} info
 * @returns {void}
 */
export function validateDataInfo(info) {
  /* Validate name */
  if (info.name === undefined) {
    throw new Error("Data name info is invalid");
  }

  /* Validate type */
  if (info.type !== undefined) {
    if (["baselayer", "overlay"].includes(info.type) === false) {
      throw new Error("Data type info is invalid");
    }
  }

  /* Validate format */
  if (
    ["jpeg", "jpg", "pbf", "png", "webp", "gif"].includes(info.format) === false
  ) {
    throw new Error("Data format info is invalid");
  }

  /* Validate json */
  /*
  if (info.format === "pbf" && info.json === undefined) {
    throw new Error(`Data json info is invalid`);
  }
  */

  /* Validate minzoom */
  if (info.minzoom < 0 || info.minzoom > 22) {
    throw new Error("Data minzoom info is invalid");
  }

  /* Validate maxzoom */
  if (info.maxzoom < 0 || info.maxzoom > 22) {
    throw new Error("Data maxzoom info is invalid");
  }

  /* Validate minzoom & maxzoom */
  if (info.minzoom > info.maxzoom) {
    throw new Error("Data zoom info is invalid");
  }

  /* Validate bounds */
  if (info.bounds !== undefined) {
    if (
      info.bounds.length !== 4 ||
      Math.abs(info.bounds[0]) > 180 ||
      Math.abs(info.bounds[2]) > 180 ||
      Math.abs(info.bounds[1]) > 90 ||
      Math.abs(info.bounds[3]) > 90 ||
      info.bounds[0] >= info.bounds[2] ||
      info.bounds[1] >= info.bounds[3]
    ) {
      throw new Error("Data bounds info is invalid");
    }
  }

  /* Validate center */
  if (info.center !== undefined) {
    if (
      info.center.length !== 3 ||
      Math.abs(info.center[0]) > 180 ||
      Math.abs(info.center[1]) > 90 ||
      info.center[2] < 0 ||
      info.center[2] > 22
    ) {
      throw new Error("Data center info is invalid");
    }
  }
}

/**
 * Validate style
 * @param {object} config
 * @param {object} styleJSON
 * @returns {Promise<void>}
 */
export async function validateStyle(config, styleJSON) {
  /* Validate style */
  const validationErrors = validateStyleMin(styleJSON);
  if (validationErrors.length > 0) {
    throw new Error(
      validationErrors
        .map((validationError) => `\n\t${validationError.message}`)
        .join()
    );
  }

  /* Validate fonts */
  if (styleJSON.glyphs !== undefined) {
    if (
      styleJSON.glyphs.startsWith("fonts://") === false &&
      styleJSON.glyphs.startsWith("https://") === false &&
      styleJSON.glyphs.startsWith("http://") === false
    ) {
      throw new Error("Invalid fonts url");
    }
  }

  /* Validate sprite */
  if (styleJSON.sprite !== undefined) {
    if (styleJSON.sprite.startsWith("sprites://") === true) {
      const spriteID = styleJSON.sprite.slice(
        10,
        styleJSON.sprite.lastIndexOf("/")
      );

      if (config.repo.sprites[spriteID] === undefined) {
        throw new Error(`Sprite "${spriteID}" is not found`);
      }
    } else if (
      styleJSON.sprite.startsWith("https://") === false &&
      styleJSON.sprite.startsWith("http://") === false
    ) {
      throw new Error("Invalid sprite url");
    }
  }

  /* Validate sources */
  await Promise.all(
    Object.keys(styleJSON.sources).map(async (id) => {
      const source = styleJSON.sources[id];

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

          if (config.repo.datas[sourceID] === undefined) {
            throw new Error(
              `Source "${id}" is not found data source "${sourceID}"`
            );
          }
        } else if (
          source.url.startsWith("https://") === false &&
          source.url.startsWith("http://") === false
        ) {
          throw new Error(`Source "${id}" is invalid data url "${url}"`);
        }
      }

      if (source.urls !== undefined) {
        if (source.urls.length === 0) {
          throw new Error(`Source "${id}" is invalid data urls`);
        }

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

            if (config.repo.datas[sourceID] === undefined) {
              throw new Error(
                `Source "${id}" is not found data source "${sourceID}"`
              );
            }
          } else if (
            url.startsWith("https://") === false &&
            url.startsWith("http://") === false
          ) {
            throw new Error(`Source "${id}" is invalid data url "${url}"`);
          }
        });
      }

      if (source.tiles !== undefined) {
        if (source.tiles.length === 0) {
          throw new Error(`Source "${id}" is invalid tile urls`);
        }

        source.tiles.forEach((tile) => {
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

            if (config.repo.datas[sourceID] === undefined) {
              throw new Error(
                `Source "${id}" is not found data source "${sourceID}"`
              );
            }
          } else if (
            tile.startsWith("https://") === false &&
            tile.startsWith("http://") === false
          ) {
            throw new Error(`Source "${id}" is invalid tile url "${url}"`);
          }
        });
      }
    })
  );
}

/**
 * Validate sprite
 * @param {string} spriteDirPath
 * @returns {Promise<void>}
 */
export async function validateSprite(spriteDirPath) {
  const [jsonSpriteFileNames, pngSpriteNames] = await Promise.all([
    findFiles(spriteDirPath, /^sprite(@\d+x)?\.json$/, false),
    findFiles(spriteDirPath, /^sprite(@\d+x)?\.png$/, false),
  ]);

  if (jsonSpriteFileNames.length !== pngSpriteNames.length) {
    throw new Error("Missing some JSON or PNG files");
  }

  const fileNameWoExts = jsonSpriteFileNames.map((jsonSpriteFileName) =>
    path.basename(jsonSpriteFileName, path.extname(jsonSpriteFileName))
  );

  await Promise.all(
    fileNameWoExts.map(async (fileNameWoExt) => {
      /* Validate JSON sprite */
      const fileData = await fsPromise.readFile(
        `${spriteDirPath}/${fileNameWoExt}.json`,
        "utf8"
      );

      Object.values(JSON.parse(fileData)).forEach((value) => {
        if (
          typeof value !== "object" ||
          "height" in value === false ||
          "pixelRatio" in value === false ||
          "width" in value === false ||
          "x" in value === false ||
          "y" in value === false
        ) {
          throw new Error("Invalid JSON file");
        }
      });

      /* Validate PNG sprite */
      const pngMetadata = await sharp(
        `${spriteDirPath}/${fileNameWoExt}.png`
      ).metadata();

      if (pngMetadata.format !== "png") {
        throw new Error("Invalid PNG file");
      }
    })
  );
}

/**
 * Download file with stream
 * @param {string} url The URL to download the file from
 * @param {string} filePath The path where the file will be saved
 * @param {number} timeout Timeout in milliseconds
 * @returns {Promise<object>}
 */
export async function downloadFileWithStream(url, filePath, timeout) {
  const tempFilePath = `${filePath}.tmp`;

  try {
    await fsPromise.mkdir(path.dirname(filePath), {
      recursive: true,
    });

    const response = await axios({
      url,
      responseType: "stream",
      method: "GET",
      timeout: timeout,
      headers: {
        "User-Agent": "Tile Server",
      },
      validateStatus: (status) => {
        return status === StatusCodes.OK;
      },
      httpAgent: new http.Agent({
        keepAlive: false,
      }),
      httpsAgent: new https.Agent({
        keepAlive: false,
      }),
    });

    const writer = fs.createWriteStream(tempFilePath);

    response.data.pipe(writer);

    return new Promise((resolve, reject) => {
      writer
        .on("finish", async () => {
          await fsPromise.rename(tempFilePath, filePath);

          resolve();
        })
        .on("error", async (error) => {
          await removeFilesOrFolder(tempFilePath);

          reject(error);
        });
    });
  } catch (error) {
    if (error.response) {
      throw new Error(
        `Failed to request "${url}" with status code: ${error.response.status} - ${error.response.statusText}`
      );
    }

    throw new Error(`Failed to request "${url}": ${error.message}`);
  }
}

/**
 * Create new tileJSON
 * @param {object} metadata
 * @returns
 */
export function createNewTileJSON(metadata) {
  // Default
  const data = {
    tilejson: "2.2.0",
    name: "Unknown",
    description: "Unknown",
    attribution: "<b>Viettel HighTech</b>",
    version: "1.0.0",
    type: "overlay",
    format: "png",
    bounds: [-180, -85.051129, 180, 85.051129],
    minzoom: 0,
    maxzoom: 22,
  };

  // Overwrite
  if (metadata !== undefined) {
    if (metadata.tilejson !== undefined) {
      data.tilejson = metadata.tilejson;
    }

    if (metadata.name !== undefined) {
      data.name = metadata.name;
    }

    if (metadata.description !== undefined) {
      data.description = metadata.description;
    }

    if (metadata.attribution !== undefined) {
      data.attribution = metadata.attribution;
    }

    if (metadata.type !== undefined) {
      data.type = metadata.type;
    }

    if (metadata.format !== undefined) {
      data.format = metadata.format;
    }

    /*
    if (metadata.scheme !== undefined) {
      data.scheme = metadata.scheme;
    }
    */

    if (metadata.version !== undefined) {
      data.version = metadata.version;
    }

    if (metadata.template !== undefined) {
      data.template = metadata.template;
    }

    if (metadata.legend !== undefined) {
      data.legend = metadata.legend;
    }

    if (metadata.tiles !== undefined) {
      data.tiles = [...metadata.tiles];
    }

    if (metadata.grids !== undefined) {
      data.grids = [...metadata.grids];
    }

    if (metadata.data !== undefined) {
      data.data = [...metadata.data];
    }

    if (metadata.bounds !== undefined) {
      data.bounds = [...metadata.bounds];
    }

    if (metadata.center !== undefined) {
      data.center = [...metadata.center];
    }

    if (metadata.minzoom !== undefined) {
      data.minzoom = metadata.minzoom;
    }

    if (metadata.maxzoom !== undefined) {
      data.maxzoom = metadata.maxzoom;
    }
  }

  // Calculate center
  if (data.center === undefined) {
    data.center = [
      (data.bounds[0] + data.bounds[2]) / 2,
      (data.bounds[1] + data.bounds[3]) / 2,
      Math.floor((data.minzoom + data.maxzoom) / 2),
    ];
  }

  // Add vector_layers and tilestats
  if (data.format === "pbf") {
    if (metadata.vector_layers !== undefined) {
      data.vector_layers = metadata.vector_layers;
    }

    if (metadata.tilestats !== undefined) {
      data.tilestats = metadata.tilestats;
    }
  }

  return data;
}

/**
 * Return either a format as an extension: png, pbf, jpg, webp, gif and
 * headers - Content-Type and Content-Encoding - for a response containing this kind of image
 * @param {Buffer} buffer input
 * @returns {object}
 */
export function detectFormatAndHeaders(buffer) {
  let format;
  const headers = {};

  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    format = "png";
    headers["Content-Type"] = "image/png";
  } else if (
    buffer[0] === 0xff &&
    buffer[1] === 0xd8 &&
    buffer[buffer.length - 2] === 0xff &&
    buffer[buffer.length - 1] === 0xd9
  ) {
    format = "jpeg"; // equivalent jpg
    headers["Content-Type"] = "image/jpeg"; // equivalent image/jpg
  } else if (
    buffer[0] === 0x47 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x38 &&
    (buffer[4] === 0x39 || buffer[4] === 0x37) &&
    buffer[5] === 0x61
  ) {
    format = "gif";
    headers["Content-Type"] = "image/gif";
  } else if (
    buffer[0] === 0x52 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x46 &&
    buffer[8] === 0x57 &&
    buffer[9] === 0x45 &&
    buffer[10] === 0x42 &&
    buffer[11] === 0x50
  ) {
    format = "webp";
    headers["Content-Type"] = "image/webp";
  } else {
    format = "pbf";
    headers["Content-Type"] = "application/x-protobuf";

    if (buffer[0] === 0x78 && buffer[1] === 0x9c) {
      headers["Content-Encoding"] = "deflate";
    } else if (buffer[0] === 0x1f && buffer[1] === 0x8b) {
      headers["Content-Encoding"] = "gzip";
    }
  }

  return {
    format,
    headers,
  };
}

/**
 * Calculate MD5 hash of a buffer
 * @param {Buffer} buffer The buffer data of the file
 * @returns {string} The MD5 hash
 */
export function calculateMD5(buffer) {
  return crypto.createHash("md5").update(buffer).digest("hex");
}

/**
 *
 */
export const gzipAsync = util.promisify(zlib.gzip);

/**
 *
 */
export const unzipAsync = util.promisify(zlib.unzip);

/**
 * Validate tileJSON
 * @param {string} schema JSON schema
 * @param {string} filePath JSON file path
 * @returns
 */
export async function validateJSON(schema, filePath) {
  try {
    const ajv = new Ajv({
      allErrors: true,
      useDefaults: true,
    });

    const data = JSON.parse(await fsPromise.readFile(filePath, "utf8"));
    const validate = ajv.compile(schema);

    if (!validate(data)) {
      throw validate.errors
        .map((error) => `\n\t${error.instancePath} ${error.message}`)
        .join();
    }
  } catch (error) {
    throw error;
  }
}

/**
 * Deep clone an object using JSON serialization
 * @param {Object} obj The object to clone
 * @returns {Object} The deep-cloned object
 */
export function deepClone(obj) {
  if (obj !== undefined) {
    return JSON.parse(JSON.stringify(obj));
  }
}
