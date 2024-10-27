"use strict";

import fsPromise from "node:fs/promises";
import os from "os";

let config;

/**
 * Load config.json file
 * @param {string} dataDir
 * @returns {Promise<void>}
 */
async function loadConfigFile(dataDir) {
  /* Read config.json file */
  const configData = JSON.parse(
    await fsPromise.readFile(`${dataDir}/config.json`, "utf8")
  );

  /* Create config object */
  config = {
    paths: {
      fonts: `${dataDir}/fonts`,
      styles: `${dataDir}/styles`,
      sprites: `${dataDir}/sprites`,
      mbtiles: `${dataDir}/mbtiles`,
      pmtiles: `${dataDir}/pmtiles`,
      xyzs: `${dataDir}/xyzs`,
    },
    options: {
      listenPort: configData.options?.listenPort || 8080,
      killEndpoint: configData.options?.killEndpoint ?? true,
      restartEndpoint: configData.options?.restartEndpoint ?? true,
      configEndpoint: configData.options?.configEndpoint ?? true,
      frontPage: configData.options?.frontPage ?? true,
      serveWMTS: configData.options?.serveWMTS ?? true,
      serveRendered: configData.options?.serveRendered ?? true,
      serveSwagger: configData.options?.serveSwagger ?? true,
      createTilesIndex: configData.options?.createTilesIndex ?? false,
      createMetadataIndex: configData.options?.createMetadataIndex ?? false,
      renderedCompression: configData.options?.renderedCompression || 6,
      loggerFormat:
        configData.options?.loggerFormat ||
        ":date[iso] [INFO] :method :url :status :res[content-length] :response-time :remote-addr :user-agent",
      maxScaleRender: configData.options?.maxScaleRender || 1,
      minPoolSize: configData.options?.minPoolSize || os.cpus().length,
      maxPoolSize: configData.options?.maxPoolSize || os.cpus().length * 2,
    },
    styles: configData.styles || {},
    datas: configData.datas || {},
    sprites: configData.sprites || {},
    fonts: configData.fonts || {},
    repo: {
      styles: {},
      rendereds: {},
      datas: {},
      fonts: {},
      sprites: {},
    },
    configFilePath: `${dataDir}/config.json`,
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
