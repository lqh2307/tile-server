"use strict";

import fsPromise from "node:fs/promises";
import path from "node:path";
import os from "os";

const folderPaths = {
  fonts: path.resolve("data", "fonts"),
  styles: path.resolve("data", "styles"),
  sprites: path.resolve("data", "sprites"),
  mbtiles: path.resolve("data", "mbtiles"),
  pmtiles: path.resolve("data", "pmtiles"),
};
const configFilePath = path.resolve("data", "config.json");

let config;

/**
 * Load config.json file
 * @returns {Promise<config>}
 */
async function loadConfigFile() {
  /* Validate config file and folders paths */
  await Promise.all([
    (async () => {
      const stat = await fsPromise.stat(configFilePath);

      if (stat.isFile() === false) {
        throw new Error(`"config.json" file: ${configFilePath} does not exist`);
      }
    })(),
    ...Object.keys(folderPaths).map(async (name) => {
      const stat = await fsPromise.stat(folderPaths[name]);

      if (stat.isDirectory() === false) {
        throw new Error(
          `"${name}" folder: ${folderPaths[name]} does not exist`
        );
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
    startupComplete: false,
  };

  return config;
}

export { configFilePath, loadConfigFile, folderPaths, config };
