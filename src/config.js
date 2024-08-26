"use strict";

import fsPromise from "node:fs/promises";
import path from "node:path";
import os from "os";

const configFilePath = path.resolve("data", "config.json");
const folders = {
  styles: path.resolve("data", "styles"),
  fonts: path.resolve("data", "fonts"),
  sprites: path.resolve("data", "sprites"),
  mbtiles: path.resolve("data", "mbtiles"),
  pmtiles: path.resolve("data", "pmtiles"),
};
let startupComplete = false;
let config;

/**
 * Load config.json file
 * @returns {Promise<config>}
 */
export async function loadConfigFile() {
  /* Validate config file and folders paths */
  await Promise.all([
    (async () => {
      const stat = await fsPromise.stat(configFilePath);

      if (stat.isFile() === false) {
        throw new Error(`"config.json" file: ${configFilePath} does not exist`);
      }
    })(),
    ...Object.keys(folders).map(async (name) => {
      const stat = await fsPromise.stat(folders[name]);

      if (stat.isDirectory() === false) {
        throw new Error(`"${name}" folder: ${folders[name]} does not exist`);
      }
    }),
  ]);

  /* Read config.json file */
  const fileData = await fsPromise.readFile(configFilePath, "utf8");
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
  return folders.styles;
}

/**
 * Get fonts folder path
 * @returns {string}
 */
export function getFontsFolderPath() {
  return folders.fonts;
}

/**
 * Get sprites folder path
 * @returns {string}
 */
export function getSpritesFolderPath() {
  return folders.sprites;
}

/**
 * Get MBTiles folder path
 * @returns {string}
 */
export function getMBTilesFolderPath() {
  return folders.mbtiles;
}

/**
 * Get PMTiles folder path
 * @returns {string}
 */
export function getPMTilesFolderPath() {
  return folders.pmtiles;
}

/**
 * Set startup status
 * @param {boolean} status
 * @returns {void}
 */
export function setStartupStatus(status) {
  startupComplete = status;
}

/**
 * Get startup status
 * @returns {boolean}
 */
export function getStartupStatus() {
  return startupComplete;
}
