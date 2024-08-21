"use strict";

import path from "node:path";
import fs from "node:fs";
import os from "os";

const config = {};

/**
 * Load config.json file
 * @returns {config}
 */
export function loadConfigFile() {
  /* Read config.json file */
  const configFilePath = path.resolve("data", "config.json");
  const fileData = fs.readFileSync(configFilePath, "utf8");
  const configData = JSON.parse(fileData);

  /* Create config object */
  Object.assign(config, {
    options: {
      paths: {
        styles: path.resolve("data", "styles"),
        fonts: path.resolve("data", "fonts"),
        sprites: path.resolve("data", "sprites"),
        mbtiles: path.resolve("data", "mbtiles"),
        pmtiles: path.resolve("data", "pmtiles"),
      },
      listenPort: configData.options?.listenPort || 8080,
      watchToKill: configData.options?.watchToKill || 0,
      watchToRestart: configData.options?.watchToRestart || 0,
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
    filePath: configFilePath,
  });

  /* Validate dirs */
  Object.values(config.options.paths).forEach((path) => {
    const stat = fs.statSync(path);

    if (stat.isDirectory() === false) {
      throw new Error(`Directory "${path}" does not exist`);
    }
  });

  return config;
}

/**
 * Get config
 * @returns {object}
 */
export function getConfig() {
  return config;
}
