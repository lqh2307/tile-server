"use strict";

import zlib from "zlib";
import util from "util";
import fs from "node:fs";
import Color from "color";
import axios from "axios";
import sharp from "sharp";
import chalk from "chalk";
import path from "node:path";
import sqlite3 from "sqlite3";
import fsPromise from "node:fs/promises";
import { PMTiles, FetchSource } from "pmtiles";
import glyphCompose from "@mapbox/glyph-pbf-composite";
import SphericalMercator from "@mapbox/sphericalmercator";
import { validateStyleMin } from "@maplibre/maplibre-gl-style-spec";

export const mercator = new SphericalMercator();

const emptyBufferColor = Buffer.from(new Color("rgba(255,255,255,0)").array());
const emptyBuffer = Buffer.alloc(0);

const fallbackFont = "Open Sans Regular";

/**
 * Create an empty tile response
 * @param {string} format tile format
 * @param {Function} callback mlgl callback
 * @returns {void}
 */
export function responseEmptyTile(format, callback) {
  if (["jpeg", "jpg", "png", "webp", "gif"].includes(format) === true) {
    // sharp lib not support jpg format
    if (format === "jpg") {
      format = "jpeg";
    }

    sharp(emptyBufferColor, {
      raw: {
        premultiplied: true,
        width: 1,
        height: 1,
        channels: 4,
      },
    })
      .toFormat(format)
      .toBuffer()
      .then((data) => {
        callback(null, {
          data: data,
        });
      })
      .catch((error) => {
        callback(error, {
          data: null,
        });
      });
  } else {
    /* pbf and other formats */
    callback(null, {
      data: emptyBuffer,
    });
  }
}

/**
 * Find matching files in directory
 * @param {string} dirPath
 * @param {RegExp} regex
 * @returns {Promise<string[]>}
 */
export async function findFiles(dirPath, regex) {
  const fileNames = await fsPromise.readdir(dirPath);

  const results = [];
  for (const fileName of fileNames) {
    const filePath = path.join(dirPath, fileName);
    const stat = await fsPromise.stat(filePath);

    if (regex.test(fileName) === true && stat.isFile() === true) {
      results.push(fileName);
    }
  }

  return results;
}

/**
 * Find matching folders in directory
 * @param {string} dirPath
 * @param {RegExp} regex
 * @returns {Promise<string[]>}
 */
export async function findFolders(dirPath, regex) {
  const folderNames = await fsPromise.readdir(dirPath);

  const results = [];
  for (const folderName of folderNames) {
    const folderPath = path.join(dirPath, folderName);
    const stat = await fsPromise.stat(folderPath);

    if (regex.test(folderName) === true && stat.isDirectory() === true) {
      results.push(folderName);
    }
  }

  return results;
}

/**
 * Get request host
 * @param {Request} req
 * @returns {string}
 */
export function getRequestHost(req) {
  return new URL(`${req.protocol}://${req.headers.host}/`).toString();
}

/**
 *
 * @param {object} fontPath
 * @param {string} ids
 * @param {string} range
 * @returns {Promise<Buffer>}
 * @returns
 */
export async function getFontsPBF(config, ids, range) {
  const data = await Promise.all(
    ids.split(",").map(async (id) => {
      try {
        /* Check font is exist? */
        if (config.repo.fonts[id] === undefined) {
          throw new Error("Font is not found");
        }

        const filePath = path.join(
          config.options.paths.fonts,
          id,
          `${range}.pbf`
        );

        return await fsPromise.readFile(filePath);
      } catch (error) {
        printLog(
          "warning",
          `Failed to get font "${id}": ${error}. Using fallback font "${fallbackFont}"...`
        );

        const filePath = path.resolve(
          "public",
          "resources",
          "template",
          "fonts",
          fallbackFont,
          `${range}.pbf`
        );

        return await fsPromise.readFile(filePath);
      }
    })
  );

  return glyphCompose.combine(data);
}

/**
 * Print log to console
 * @param {"info"|"warning"|"error"} level
 * @param {string} msg
 * @returns {void}
 */
export function printLog(level, msg) {
  const dateTime = new Date().toISOString();

  if (level === "warning") {
    console.warn(chalk.yellow(`${dateTime} [WARNING] ${msg}`));
  } else if (level === "error") {
    console.error(chalk.red(`${dateTime} [ERROR] ${msg}`));
  } else {
    console.info(`${dateTime} [INFO] ${msg}`);
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
    throw new Error(`Missing some pbf files`);
  }
}

/**
 * Validate data info
 * @param {object} info
 * @returns {Promise<void>}
 */
export async function validateDataInfo(info) {
  /* Validate name */
  if (info.name === undefined) {
    throw new Error(`Data name info is invalid`);
  }

  /* Validate type */
  if (info.type !== undefined) {
    if (["baselayer", "overlay"].includes(info.type) === false) {
      throw new Error(`Data type info is invalid`);
    }
  }

  /* Validate format */
  if (
    ["jpeg", "jpg", "pbf", "png", "webp", "gif"].includes(info.format) === false
  ) {
    throw new Error(`Data format info is invalid`);
  }

  /* Validate minzoom */
  if (info.minzoom < 0 || info.minzoom > 22) {
    throw new Error(`Data minzoom info is invalid`);
  }

  /* Validate maxzoom */
  if (info.maxzoom < 0 || info.maxzoom > 22) {
    throw new Error(`Data maxzoom info is invalid`);
  }

  /* Validate minzoom & maxzoom */
  if (info.minzoom > info.maxzoom) {
    throw new Error(`Data zoom info is invalid`);
  }

  /* Validate bounds */
  if (info.bounds !== undefined) {
    if (
      info.bounds.length !== 4 ||
      Math.abs(info.bounds[0]) > 180 ||
      Math.abs(info.bounds[2]) > 180 ||
      Math.abs(info.bounds[1]) > 90 ||
      Math.abs(info.bounds[3]) > 90
    ) {
      throw new Error(`Data bounds info is invalid`);
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
      throw new Error(`Data center info is invalid`);
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
        .map((validationError) => "\n\t" + validationError.message)
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
  Object.keys(styleJSON.sources).forEach((id) => {
    const source = styleJSON.sources[id];

    if (source.url !== undefined) {
      if (
        source.url.startsWith("pmtiles://") === true ||
        source.url.startsWith("mbtiles://") === true
      ) {
        const sourceID = source.url.slice(10);

        if (config.repo.datas[sourceID] === undefined) {
          throw new Error(`Source "${id}" is not found`);
        }
      } else if (
        source.url.startsWith("https://") === false &&
        source.url.startsWith("http://") === false
      ) {
        throw new Error(`Source "${id}" is invalid url`);
      }
    }

    if (source.urls !== undefined) {
      if (source.urls.length === 0) {
        throw new Error(`Source "${id}" is invalid urls`);
      }

      source.urls.forEach((url) => {
        if (
          url.startsWith("pmtiles://") === true ||
          url.startsWith("mbtiles://") === true
        ) {
          const sourceID = url.slice(10);

          if (config.repo.datas[sourceID] === undefined) {
            throw new Error(`Source "${id}" is not found`);
          }
        } else if (
          url.startsWith("https://") === false &&
          url.startsWith("http://") === false
        ) {
          throw new Error(`Source "${id}" is invalid urls`);
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
          tile.startsWith("mbtiles://") === true
        ) {
          const sourceID = tile.slice(10);

          if (config.repo.datas[sourceID] === undefined) {
            throw new Error(`Source "${id}" is not found`);
          }
        } else if (
          tile.startsWith("https://") === false &&
          tile.startsWith("http://") === false
        ) {
          throw new Error(`Source "${id}" is invalid tile urls`);
        }
      });
    }
  });
}

/**
 * Validate sprite
 * @param {string} spriteDirPath
 * @returns {Promise<void>}
 */
export async function validateSprite(spriteDirPath) {
  const [jsonSpriteFileNames, pngSpriteNames] = await Promise.all([
    findFiles(spriteDirPath, /^sprite(@\d+x)?\.json$/),
    findFiles(spriteDirPath, /^sprite(@\d+x)?\.png$/),
  ]);

  if (jsonSpriteFileNames.length !== pngSpriteNames.length) {
    throw new Error(`Missing some json or png files`);
  }

  const spriteFileNames = jsonSpriteFileNames.map((jsonSpriteFileName) =>
    path.basename(jsonSpriteFileName, path.extname(jsonSpriteFileName))
  );

  await Promise.all(
    spriteFileNames.map(async (spriteFileNames) => {
      /* Validate JSON sprite */
      let filePath = path.join(spriteDirPath, `${spriteFileNames}.json`);
      const fileData = await fsPromise.readFile(filePath, "utf8");
      const jsonData = JSON.parse(fileData);

      Object.values(jsonData).forEach((value) => {
        if (
          typeof value !== "object" ||
          "height" in value === false ||
          "pixelRatio" in value === false ||
          "width" in value === false ||
          "x" in value === false ||
          "y" in value === false
        ) {
          throw new Error(`Invalid json file`);
        }
      });

      /* Validate PNG sprite */
      filePath = path.join(spriteDirPath, `${spriteFileNames}.png`);

      const pngMetadata = await sharp(filePath).metadata();

      if (pngMetadata.format !== "png") {
        throw new Error("Invalid png file");
      }
    })
  );
}

/**
 *
 * @param {object} repo
 * @param {string} repoFilePath
 */
export async function createRepoFile(repo, repoFilePath) {
  function getCircularReplacer() {
    const seen = new WeakMap();
    const paths = new Map();

    return (key, value) => {
      if (typeof value === "object" && value !== null) {
        if (seen.has(value)) {
          return;
        }

        seen.set(value, true);
        paths.set(value, key);
      }

      return value;
    };
  }

  const jsonData = JSON.stringify(repo, getCircularReplacer(), 2);

  await fsPromise.writeFile(repoFilePath, jsonData, "utf8");
}

/**
 * Download file
 * @param {string} url
 * @param {string} outputPath
 * @param {boolean} overwrite
 * @returns {Promise<string>}
 * @returns
 */
export async function downloadFile(url, outputPath, overwrite = false) {
  try {
    const stat = await fsPromise.stat(outputPath);

    if (stat.isFile() === true && stat.size > 0 && overwrite === false) {
      return outputPath;
    }
  } catch (_) {}

  await fsPromise.mkdir(path.dirname(outputPath), {
    recursive: true,
  });

  const response = await axios({
    url,
    method: "GET",
    responseType: "stream",
  });

  return new Promise((resolve, reject) => {
    const writer = fsPromise.createWriteStream(outputPath);

    response.data.pipe(writer);

    writer.on("error", (error) => {
      writer.close(() => reject(error));
    });

    writer.on("finish", () => {
      writer.close(() => resolve(outputPath));
    });
  });
}

/**
 * Private class for PMTiles
 */
class PMTilesFileSource {
  constructor(fd) {
    this.fd = fd;
  }

  getKey() {
    return this.fd;
  }

  async getBytes(offset, length) {
    const buffer = Buffer.alloc(length);

    fs.readSync(this.fd, buffer, 0, buffer.length, offset);

    return {
      data: buffer.buffer.slice(
        buffer.byteOffset,
        buffer.byteOffset + buffer.byteLength
      ),
    };
  }
}

/**
 * Open PMTiles
 * @param {string} filePath
 * @returns {Promise<object>}
 */
export async function openPMTiles(filePath) {
  let source;

  if (
    filePath.startsWith("https://") === true ||
    filePath.startsWith("http://") === true
  ) {
    source = new FetchSource(filePath);
  } else {
    const fileData = fs.openSync(filePath, "r");

    source = new PMTilesFileSource(fileData);
  }

  return new PMTiles(source);
}

/**
 * Get PMTiles infos
 * @param {object} pmtilesSource
 * @param {boolean} includeJSON
 * @returns {Promise<object>}
 */
export async function getPMTilesInfos(pmtilesSource, includeJSON = false) {
  const metadata = await getPMTilesMetadatas(pmtilesSource);

  const xyzTileJSON = createNewXYZTileJSON(metadata);

  if (includeJSON === true) {
    xyzTileJSON.vector_layers = metadata.vector_layers;
    xyzTileJSON.tilestats = metadata.tilestats;
  }

  return createNewXYZTileJSON(metadata);
}

/**
 * Get PMTiles metadata
 * @param {object} pmtilesSource
 * @returns {Promise<object>}
 */
export async function getPMTilesMetadatas(pmtilesSource) {
  const [header, metadata] = await Promise.all([
    pmtilesSource.getHeader(),
    pmtilesSource.getMetadata(),
  ]);

  if (header.tileType === 1) {
    metadata.format = "pbf";
  } else if (header.tileType === 2) {
    metadata.format = "png";
  } else if (header.tileType === 3) {
    metadata.format = "jpeg";
  } else if (header.tileType === 4) {
    metadata.format = "webp";
  } else if (header.tileType === 5) {
    metadata.format = "avif";
  }

  if (header.minZoom !== undefined) {
    metadata.minzoom = Number(header.minZoom);
  }

  if (header.maxZoom !== undefined) {
    metadata.maxzoom = Number(header.maxZoom);
  }

  if (
    header.minLon !== undefined &&
    header.minLat !== undefined &&
    header.maxLon !== undefined &&
    header.maxLat !== undefined
  ) {
    metadata.bounds = [
      Number(header.minLon),
      Number(header.minLat),
      Number(header.maxLon),
      Number(header.maxLat),
    ];
  }

  if (
    header.centerLon !== undefined &&
    header.centerLat !== undefined &&
    header.centerZoom !== undefined
  ) {
    metadata.center = [
      Number(header.centerLon),
      Number(header.centerLat),
      Number(header.centerZoom),
    ];
  }

  return metadata;
}

/**
 * Get PMTiles tile
 * @param {object} pmtilesSource
 * @param {number} z
 * @param {number} x
 * @param {number} y
 * @returns {Promise<object>}
 */
export async function getPMTilesTile(pmtilesSource, z, x, y) {
  const zxyTile = await pmtilesSource.getZxy(z, x, y);

  if (!zxyTile?.data) {
    throw new Error("Tile does not exist");
  }

  const data = Buffer.from(zxyTile.data);

  return {
    data: data,
    headers: detectFormatAndHeaders(data).headers,
  };
}

/**
 * Open MBTiles
 * @param {string} filePath
 * @returns {Promise<object>}
 */
export async function openMBTiles(filePath) {
  return new Promise((resolve, reject) => {
    const mbtilesSource = new sqlite3.Database(
      filePath,
      sqlite3.OPEN_READONLY,
      (error) => {
        if (error) {
          return reject(error);
        }

        resolve(mbtilesSource);
      }
    );
  });
}

/**
 * Get MBTiles tile
 * @param {object} mbtilesSource
 * @param {number} z
 * @param {number} x
 * @param {number} y
 * @returns {Promise<object>}
 */
export async function getMBTilesTile(mbtilesSource, z, x, y) {
  return new Promise((resolve, reject) => {
    mbtilesSource.get(
      "SELECT tile_data FROM tiles WHERE zoom_level = ? AND tile_column = ? AND tile_row = ?",
      z,
      x,
      (1 << z) - 1 - y, // Flip Y to convert TMS scheme => XYZ scheme
      (error, row) => {
        if (error) {
          return reject(error);
        }

        if (!row?.tile_data) {
          return reject(new Error("Tile does not exist"));
        }

        const data = Buffer.from(row.tile_data);

        resolve({
          data: data,
          headers: detectFormatAndHeaders(data).headers,
        });
      }
    );
  });
}

/**
 * Create new XYZ tileJSON
 * @param {object} metadata
 * @returns
 */
export function createNewXYZTileJSON(metadata) {
  // Default
  const data = {
    tilejson: "2.2.0",
    name: "Unknown",
    description: "Unknown",
    attribution: "<b>Viettel HighTech</b>",
    version: "1.0.0",
    type: "overlay",
    format: "png",
    scheme: "xyz", // Guarantee scheme always is XYZ
    bounds: [-180, -85.051128779807, 180, 85.051128779807],
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

  if (data.center === undefined) {
    data.center = [
      (data.bounds[0] + data.bounds[2]) / 2,
      (data.bounds[1] + data.bounds[3]) / 2,
      Math.floor((data.minzoom + data.maxzoom) / 2),
    ];
  }

  return data;
}

/**
 * Get MBTiles metadata
 * @param {object} mbtilesSource
 * @returns {Promise<object>}
 */
export async function getMBTilesMetadatas(mbtilesSource) {
  return new Promise((resolve, reject) => {
    mbtilesSource.all("SELECT name, value FROM metadata", (error, rows) => {
      if (error) {
        return reject(error);
      }

      const metadata = {};

      if (rows) {
        rows.forEach((row) => {
          switch (row.name) {
            case "json":
              try {
                Object.assign(metadata, JSON.parse(row.value));
              } catch (error) {
                return reject(error);
              }

              break;
            case "minzoom":
            case "maxzoom":
              metadata[row.name] = Number(row.value);

              break;
            case "center":
            case "bounds":
              metadata[row.name] = row.value
                .split(",")
                .map((elm) => Number(elm));

              break;
            default:
              metadata[row.name] = row.value;

              break;
          }
        });
      }

      resolve(metadata);
    });
  });
}

/**
 * Get MBTiles infos
 * @param {object} mbtilesSource
 * @param {boolean} includeJSON
 * @returns {Promise<object>}
 */
export async function getMBTilesInfos(mbtilesSource, includeJSON = false) {
  const metadata = await getMBTilesMetadatas(mbtilesSource);

  if (metadata.minzoom === undefined) {
    await new Promise((resolve, reject) => {
      mbtilesSource.get(
        "SELECT MIN(zoom_level) AS minzoom FROM tiles",
        (error, row) => {
          if (error) {
            return reject(error);
          }

          if (row) {
            metadata.minzoom = row.minzoom;
          }

          resolve();
        }
      );
    });
  }

  if (metadata.maxzoom === undefined) {
    await new Promise((resolve, reject) => {
      mbtilesSource.get(
        "SELECT MAX(zoom_level) AS maxzoom FROM tiles",
        (error, row) => {
          if (error) {
            return reject(error);
          }

          if (row) {
            metadata.maxzoom = row.maxzoom;
          }

          resolve();
        }
      );
    });
  }

  if (metadata.format === undefined) {
    await new Promise((resolve, reject) => {
      mbtilesSource.get("SELECT tile_data FROM tiles LIMIT 1", (error, row) => {
        if (error) {
          return reject(error);
        }

        if (row) {
          metadata.format = detectFormatAndHeaders(row.tile_data).format;
        }

        resolve();
      });
    });
  }

  const xyzTileJSON = createNewXYZTileJSON(metadata);

  if (includeJSON === true) {
    xyzTileJSON.vector_layers = metadata.vector_layers;
    xyzTileJSON.tilestats = metadata.tilestats;
  }

  return xyzTileJSON;
}

/**
 * Close MBTiles
 * @param {object} mbtilesSource
 * @returns {Promise<void>}
 */
export async function closeMBTiles(mbtilesSource) {
  return new Promise((resolve, reject) => {
    mbtilesSource.close((error) => {
      if (error) {
        return reject(error);
      }

      resolve();
    });
  });
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
    format = "jpeg";
    headers["Content-Type"] = "image/jpeg";
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

export const gzipAsync = util.promisify(zlib.gzip);

export const unzipAsync = util.promisify(zlib.unzip);
