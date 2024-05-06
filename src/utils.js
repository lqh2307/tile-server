"use strict";

import path from "node:path";
import fs from "node:fs";
import glyphCompose from "@mapbox/glyph-pbf-composite";
import chalk from "chalk";

export const httpTester = /^https?:\/\//i;

/**
 * Restrict user input to an allowed set of options.
 * @param opts
 * @param root0
 * @param root0.defaultValue
 */
export function allowedOptions(opts, { defaultValue } = {}) {
  const values = Object.fromEntries(opts.map((key) => [key, key]));

  return (value) => values[value] || defaultValue;
}

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

  return urlObject;
};

export const getUrl = (req) => {
  return getUrlObject(req).toString();
};

export const getTileUrls = (req, domains, path, tileSize, format, aliases) => {
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
  if (!domains || domains.length == 0) {
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

  if (aliases && aliases[format]) {
    format = aliases[format];
  }

  let tileParams = `{z}/{x}/{y}`;
  if (tileSize && ["png", "jpg", "jpeg", "webp"].includes(format)) {
    tileParams = `${tileSize}/{z}/{x}/{y}`;
  }

  let xForwardedPath = `${req.get("X-Forwarded-Path") ? "/" + req.get("X-Forwarded-Path") : ""}`;
  const uris = domains.map(
    (domain) =>
      `${req.protocol}://${domain}${xForwardedPath}/${path}/${tileParams}.${format}${query}`
  );

  return uris;
};

export const fixTileJSONCenter = (tileJSON) => {
  if (tileJSON.bounds && !tileJSON.center) {
    const fitWidth = 1024;
    const tiles = fitWidth / 256;
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

const getFontPbf = (fontPath, name, range) =>
  new Promise((resolve, reject) => {
    const filePath = path.join(fontPath, name, `${range}.pbf`);

    fs.readFile(filePath, (err, data) => {
      if (err) {
        const fallbackFont = "Open Sans Regular";

        printLog(
          "error",
          `${err.message}. Trying to use fallback font ${fallbackFont}`
        );

        getFontPbf(fontPath, fallbackFont, range).then(resolve, reject);
      } else {
        resolve(data);
      }
    });
  });

export const getFontsPbf = async (fontPath, names, range) => {
  const fonts = names.split(",");

  const values = await Promise.all(
    fonts.map((font) => getFontPbf(fontPath, font, range))
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

export const findFiles = async (
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
        const subResults = await findFiles(filePath, regex, true);

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
