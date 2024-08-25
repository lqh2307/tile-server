"use strict";

import path from "node:path";
import fs from "node:fs";
import os from "os";

let configFilePath;
let folderPaths;
let config;

/**
 * Load config.json file
 * @returns {config}
 */
export function loadConfigFile() {
  /* Validate config file path */
  configFilePath = path.resolve("data", "config.json");

  if (fs.statSync(configFilePath).isFile() === false) {
    throw new Error(`"config.json" file: ${configFilePath} does not exist`);
  }

  /* Validate folder paths */
  folderPaths = {
    styles: path.resolve("data", "styles"),
    fonts: path.resolve("data", "fonts"),
    sprites: path.resolve("data", "sprites"),
    mbtiles: path.resolve("data", "mbtiles"),
    pmtiles: path.resolve("data", "pmtiles"),
  };

  Object.keys(folderPaths).forEach((name) => {
    if (fs.statSync(folderPaths[name]).isDirectory() === false) {
      throw new Error(`"${name}" folder: ${folderPaths[name]} does not exist`);
    }
  });

  /* Read config.json file */
  const fileData = fs.readFileSync(configFilePath, "utf8");
  const configData = JSON.parse(fileData);

  /* Create config object */
  config = {
    options: {
      listenPort: configData.options?.listenPort || 8080,
      killEndpoint: configData.options?.killEndpoint ?? true,
      restartEndpoint: configData.options?.restartEndpoint ?? true,
      frontPage: configData.options?.frontPage ?? true,
      serveWMTS: configData.options?.serveWMTS ?? true,
      serveRendered: configData.options?.serveRendered ?? true,
      serveSwagger: configData.options?.serveSwagger ?? true,
      renderedCompression: configData.options?.renderedCompression || 6,
      loggerFormat:
        configData.options?.loggerFormat ||
        ":date[iso] [INFO] :method :url :status :res[content-length] :response-time :remote-addr :user-agent",
      maxScaleRender: configData.options?.maxScaleRender || 1,
      minPoolSize: configData.options?.minPoolSize || os.cpus().length,
      maxPoolSize: configData.options?.maxPoolSize || os.cpus().length * 2,
    },
    styles: configData.styles || {},
    data: configData.data || {},
    sprites: configData.sprites || {},
    fonts: configData.fonts || {},
    repo: {
      styles: {},
      rendereds: {},
      datas: {},
      fonts: {},
      sprites: {},
    },
    startupComplete: false,
  };

  return config;
}

/**
 * Get config
 * @returns {object}
 */
export function getConfig() {
  return config;
}

/**
 * Get config file path
 * @returns {string}
 */
export function getConfigFilePath() {
  return configFilePath;
}

/**
 * Get styles folder path
 * @returns {string}
 */
export function getStylesFolderPath() {
  return folderPaths.styles;
}

/**
 * Get fonts folder path
 * @returns {string}
 */
export function getFontsFolderPath() {
  return folderPaths.fonts;
}

/**
 * Get sprites folder path
 * @returns {string}
 */
export function getSpritesFolderPath() {
  return folderPaths.sprites;
}

/**
 * Get MBTiles folder path
 * @returns {string}
 */
export function getMBTilesFolderPath() {
  return folderPaths.mbtiles;
}

/**
 * Get PMTiles folder path
 * @returns {string}
 */
export function getPMTilesFolderPath() {
  return folderPaths.pmtiles;
}
