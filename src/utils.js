"use strict";

import path from "node:path";
import fs from "node:fs";
import glyphCompose from "@mapbox/glyph-pbf-composite";
import chalk from "chalk";
import { pngValidator } from "png-validator";

export const httpTester = /^https?:\/\//i;

/**
 * Replace local:// urls with public http(s):// urls
 * @param req
 * @param url
 */
export function fixUrl(req, url) {
  if (!url || typeof url !== "string" || url.indexOf("local://") !== 0) {
    return url;
  }

  const queryParams = [];
  if (req.query.key) {
    queryParams.unshift(`key=${encodeURIComponent(req.query.key)}`);
  }

  let query = "";
  if (queryParams.length) {
    query = `?${queryParams.join("&")}`;
  }

  return url.replace("local://", getUrl(req)) + query;
}

/**
 * Generate new URL object
 * @param req
 * @params {object} req - Express request
 * @returns {URL} object
 */
const getUrlObject = (req) => {
  const urlObject = new URL(`${req.protocol}://${req.headers.host}/`);

  // support overriding hostname by sending X-Forwarded-Host http header
  urlObject.hostname = req.hostname;

  // support add url prefix by sending X-Forwarded-Path http header
  const xForwardedPath = req.get("X-Forwarded-Path");
  if (xForwardedPath) {
    urlObject.pathname = path.posix.join(xForwardedPath, urlObject.pathname);
  }

  return urlObject;
};

export const getUrl = (req) => {
  return getUrlObject(req).toString();
};

export const getTileUrls = (req, domains, path, tileSize, format) => {
  const urlObject = getUrlObject(req);

  if (domains) {
    if (domains.constructor === String && domains.length > 0) {
      domains = domains.split(",");
    }

    const hostParts = urlObject.host.split(".");
    const relativeSubdomainsUsable =
      hostParts.length > 1 &&
      !/^([0-9]{1,3}\.){3}[0-9]{1,3}(\:[0-9]+)?$/.test(urlObject.host);
    const newDomains = [];
    for (const domain of domains) {
      if (domain.indexOf("*") !== -1) {
        if (relativeSubdomainsUsable) {
          const newParts = hostParts.slice(1);
          newParts.unshift(domain.replace("*", hostParts[0]));
          newDomains.push(newParts.join("."));
        }
      } else {
        newDomains.push(domain);
      }
    }

    domains = newDomains;
  }

  if (!domains || domains.length === 0) {
    domains = [urlObject.host];
  }

  const queryParams = [];
  if (req.query.key) {
    queryParams.push(`key=${encodeURIComponent(req.query.key)}`);
  }

  if (req.query.style) {
    queryParams.push(`style=${encodeURIComponent(req.query.style)}`);
  }

  const query = queryParams.length > 0 ? `?${queryParams.join("&")}` : "";

  let tileParams = `{z}/{x}/{y}`;
  if (tileSize && ["png", "jpg", "jpeg", "webp"].includes(format)) {
    tileParams = `${tileSize}/{z}/{x}/{y}`;
  }

  const xForwardedPath = `${req.get("X-Forwarded-Path") ? "/" + req.get("X-Forwarded-Path") : ""}`;
  const uris = domains.map(
    (domain) =>
      `${req.protocol}://${domain}${xForwardedPath}/${path}/${tileParams}.${format}${query}`
  );

  return uris;
};

export const fixTileJSONCenter = (tileJSON) => {
  if (tileJSON.bounds && !tileJSON.center) {
    const tiles = 4;

    tileJSON.center = [
      (tileJSON.bounds[0] + tileJSON.bounds[2]) / 2,
      (tileJSON.bounds[1] + tileJSON.bounds[3]) / 2,
      Math.round(
        -Math.log((tileJSON.bounds[2] - tileJSON.bounds[0]) / 360 / tiles) /
          Math.LN2
      ),
    ];
  }
};

const getFontPbf = (fontPath, name, range) => {
  const filePath = path.join(fontPath, name, `${range}.pbf`);

  try {
    return fs.readFileSync(filePath);
  } catch (error) {
    throw error;
  }
};

export const getFontsPbf = async (fontPath, names, range) => {
  const fonts = names.split(",");

  const values = await Promise.all(
    fonts.map(async (font) => {
      try {
        return getFontPbf(fontPath, font, range);
      } catch (error) {
        const fallbackFont = "Open Sans Regular";

        printLog(
          "warning",
          `Failed to load font "${font}": ${error.message}. Trying to use fallback font ${fallbackFont}`
        );

        return getFontPbf(fontPath, fallbackFont, range);
      }
    })
  );

  return glyphCompose.combine(values);
};

export const isValidHttpUrl = (string) => {
  try {
    const url = new URL(string);

    return url.protocol === "http:" || url.protocol === "https:";
  } catch (_) {
    return false;
  }
};

export const findFiles = (
  dirPath,
  regex,
  isRecurse = false,
  isJustBaseName = false
) => {
  if (isRecurse) {
    const files = fs.readdirSync(dirPath);
    const results = [];

    for (const file of files) {
      const filePath = path.join(dirPath, file);

      if (regex.test(file) && fs.statSync(filePath).isDirectory()) {
        const subResults = findFiles(filePath, regex, true);

        results.push(
          ...subResults.map((subResult) => path.join(file, subResult))
        );
      } else if (regex.test(file) && fs.statSync(filePath).isFile()) {
        results.push(file);
      }
    }

    if (isJustBaseName) {
      return results.map((result) => path.basename(result));
    }

    return results;
  } else {
    const fileNames = fs.readdirSync(dirPath);

    return fileNames.filter(
      (fileName) =>
        regex.test(fileName) &&
        fs.statSync(path.join(dirPath, fileName)).isFile()
    );
  }
};

export const findDirs = (dirPath, regex) => {
  const dirNames = fs.readdirSync(dirPath);

  return dirNames.filter(
    (dirName) =>
      regex.test(dirName) &&
      fs.statSync(path.join(dirPath, dirName)).isDirectory()
  );
};

export const printLog = (level, msg) => {
  switch (level) {
    case "debug": {
      const logFormat = `${chalk.gray(new Date().toISOString())} ${chalk.magenta(`[DEBUG] ${msg}`)}`;

      console.debug(logFormat);

      break;
    }

    case "warning": {
      const logFormat = `${chalk.gray(new Date().toISOString())} ${chalk.yellow(`[WARNING] ${msg}`)}`;

      console.warn(logFormat);

      break;
    }

    case "error": {
      const logFormat = `${chalk.gray(new Date().toISOString())} ${chalk.red(`[ERROR] ${msg}`)}`;

      console.error(logFormat);

      break;
    }

    default: {
      const logFormat = `${chalk.gray(new Date().toISOString())} ${chalk.green(`[INFO] ${msg}`)}`;

      console.info(logFormat);

      break;
    }
  }
};

export const validatePBFFont = (pbfDirPath) => {
  try {
    const fileNames = findFiles(pbfDirPath, /^\d{1,5}-\d{1,5}\.pbf{1}$/);

    if (fileNames.length !== 256) {
      throw Error(`Font is invalid`);
    }
  } catch (error) {
    throw error;
  }
};

export const validateSVGIcon = (svgFilePath) => {
  const fileName = path.basename(svgFilePath);

  try {
    if (!/^\w+.svg{1}$/.test(fileName) || !fs.statSync(svgFilePath).isFile()) {
      throw Error(`Icon is invalid`);
    }
  } catch (error) {
    throw error;
  }
};

export const validateSprite = (spriteDirPath) => {
  try {
    const spritePattern = /^sprite(@\d+x)?\.(png|json){1}$/;

    const fileNameWoExts = [
      ...new Set(
        findFiles(spriteDirPath, spritePattern).map((fileName) =>
          path.basename(fileName, path.extname(fileName))
        )
      ),
    ];

    if (fileNameWoExts.length === 0) {
      throw Error(`Sprite is empty`);
    }

    fileNameWoExts.forEach((fileNameWoExt) => {
      const jsonFilePath = path.join(spriteDirPath, `${fileNameWoExt}.json`);
      const pngFilePath = path.join(spriteDirPath, `${fileNameWoExt}.png`);

      const jsonFile = fs.readFileSync(jsonFilePath, "utf8");

      const jsonData = JSON.parse(jsonFile);

      /* Validate JSON sprite */
      Object.keys(jsonData).forEach((key) => {
        const value = jsonData[key];

        if (
          typeof value !== "object" ||
          !("height" in value) ||
          !("pixelRatio" in value) ||
          !("width" in value) ||
          !("x" in value) ||
          !("y" in value)
        ) {
          throw Error(
            `One of properties "height", "pixelRatio", "width", "x", "y" for sprite "${key}" is empty`
          );
        }
      });

      /* Validate PNG sprite */
      const pngData = fs.readFileSync(pngFilePath);

      pngValidator(pngData);
    });
  } catch (error) {
    throw error;
  }
};
