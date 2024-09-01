"use strict";

import fsPromise from "node:fs/promises";
import os from "os";

let config;

/**
 * Load config.json file
 * @param {string} configFilePath
 * @returns {Promise<void>}
 */
async function loadConfigFile(configFilePath) {
  /* Read config.json file */
  const fileData = await fsPromise.readFile(configFilePath, "utf8");
  const configData = JSON.parse(fileData);

  /* Create config object */
  config = {
    paths: {
      fonts: "data/fonts",
      styles: "data/styles",
      sprites: "data/sprites",
      mbtiles: "data/mbtiles",
      pmtiles: "data/pmtiles",
    },
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
    fallbackFont: "Open Sans Regular",
    startupComplete: false,
  };

  /* Validate folders paths */
  await Promise.all(
    Object.keys(config.paths).map(async (name) => {
      const stat = await fsPromise.stat(config.paths[name]);

      if (stat.isDirectory() === false) {
        throw new Error(
          `"${name}" folder: ${config.paths[name]} does not exist`
        );
      }
    })
  );
}

export { loadConfigFile, config };
