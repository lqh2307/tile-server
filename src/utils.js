"use strict";

import path from "node:path";
import fs from "node:fs";
import glyphCompose from "@mapbox/glyph-pbf-composite";
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
function getUrlObject(req) {
  const urlObject = new URL(`${req.protocol}://${req.headers.host}/`);

  // support overriding hostname by sending X-Forwarded-Host http header
  urlObject.hostname = req.hostname;

  // support add url prefix by sending X-Forwarded-Path http header
  const xForwardedPath = req.get("X-Forwarded-Path");
  if (xForwardedPath) {
    urlObject.pathname = path.posix.join(xForwardedPath, urlObject.pathname);
  }

  return urlObject;
}

export function getUrl(req) {
  return getUrlObject(req).toString();
}

export function getTileUrls(req, domains, path, tileSize, format) {
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
      `${req.protocol}://${domain}${xForwardedPath}/${path}/${tileParams}.${format || ""}${query}`
  );

  return uris;
}

export function fixTileJSONCenter(tileJSON) {
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
}

export async function getFontsPbf(fontPath, names, range) {
  const fonts = names.split(",");

  const values = await Promise.all(
    fonts.map(async (font) => {
      try {
        return fs.readFileSync(path.join(fontPath, font, `${range}.pbf`));
      } catch (error) {
        const fallbackFont = "Open Sans Regular";

        printLog(
          "warning",
          `Failed to load font "${font}": ${error.message}. Trying to use fallback font "${fallbackFont}"`
        );

        return fs.readFileSync(
          path.resolve(
            "public",
            "resources",
            "fonts",
            fallbackFont,
            `${range}.pbf`
          )
        );
      }
    })
  );

  return glyphCompose.combine(values);
}

export function isValidHttpUrl(string) {
  try {
    const url = new URL(string);

    return url.protocol === "http:" || url.protocol === "https:";
  } catch (_) {
    return false;
  }
}

export function findFiles(
  dirPath,
  regex,
  isRecurse = false,
  isJustBaseName = false
) {
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
}

export function findDirs(dirPath, regex) {
  const dirNames = fs.readdirSync(dirPath);

  return dirNames.filter(
    (dirName) =>
      regex.test(dirName) &&
      fs.statSync(path.join(dirPath, dirName)).isDirectory()
  );
}

export function printLog(level, msg) {
  switch (level) {
    case "debug": {
      const logFormat = `${new Date().toISOString()} ${`[DEBUG] ${msg}`}`;

      console.debug(logFormat);

      break;
    }

    case "warning": {
      const logFormat = `${new Date().toISOString()} ${`[WARNING] ${msg}`}`;

      console.warn(logFormat);

      break;
    }

    case "error": {
      const logFormat = `${new Date().toISOString()} ${`[ERROR] ${msg}`}`;

      console.error(logFormat);

      break;
    }

    default: {
      const logFormat = `${new Date().toISOString()} ${`[INFO] ${msg}`}`;

      console.info(logFormat);

      break;
    }
  }
}

export function validatePBFFont(pbfDirPath) {
  try {
    const fileNames = findFiles(pbfDirPath, /^\d{1,5}-\d{1,5}\.pbf{1}$/);

    if (fileNames.length !== 256) {
      throw Error(`Font is invalid`);
    }
  } catch (error) {
    throw error;
  }
}

export function validateSVGIcon(svgFilePath) {
  const fileName = path.basename(svgFilePath);

  try {
    if (!/^\w+.svg{1}$/.test(fileName) || !fs.statSync(svgFilePath).isFile()) {
      throw Error(`Icon is invalid`);
    }
  } catch (error) {
    throw error;
  }
}

export function validateSprite(spriteDirPath) {
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
      /* Validate JSON sprite */
      const jsonFile = fs.readFileSync(
        path.join(spriteDirPath, `${fileNameWoExt}.json`),
        "utf8"
      );

      const jsonData = JSON.parse(jsonFile);

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
      const pngData = fs.readFileSync(
        path.join(spriteDirPath, `${fileNameWoExt}.png`)
      );

      pngValidator(pngData);
    });
  } catch (error) {
    throw error;
  }
}

export const getScale = (scale = "@1x") => Number(scale.slice(1, -1)) || 1;

export function createRepoFile(repo, repoFilePath) {
  function getCircularReplacer() {
    const seen = new WeakMap();
    const paths = new Map();

    return (key, value) => {
      if (typeof value === "object" && value !== null) {
        if (seen.has(value)) {
          console.log(
            `Circular reference detected at ${paths.get(value)} -> ${key}`
          );
          return;
        }

        seen.set(value, true);
        paths.set(value, key);
      }

      return value;
    };
  }

  const jsonData = JSON.stringify(repo, getCircularReplacer(), 2);

  fs.writeFile(repoFilePath, jsonData, "utf8", (error) => {
    if (error) {
      throw error;
    }
  });
}

export function findCircularReferences(obj, parentName = "root") {
  const visited = new Set();
  const paths = new Map();

  function detectCycles(obj, path) {
    if (typeof obj !== "object" || obj === null) return;

    if (visited.has(obj)) {
      console.log(
        `Circular reference detected at path: ${paths.get(obj)} -> ${path}`
      );
      return;
    }

    visited.add(obj);
    paths.set(obj, path);

    for (const key in obj) {
      if (obj.hasOwnProperty(key)) {
        detectCycles(obj[key], `${path}.${key}`);
      }
    }

    visited.delete(obj);
    paths.delete(obj);
  }

  detectCycles(obj, parentName);
}
