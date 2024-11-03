"use strict";

import fsPromise from "node:fs/promises";

let config;
let seed;
let cleanUp;

/**
 * Load config.json file
 * @param {string} dataDir
 * @returns {Promise<void>}
 */
async function loadConfigFile(dataDir) {
  /* Read config.json file */
  config = JSON.parse(
    await fsPromise.readFile(`${dataDir}/config.json`, "utf8")
  );

  /* Fix object */
  config.paths = {
    fonts: `${dataDir}/fonts`,
    styles: `${dataDir}/styles`,
    sprites: `${dataDir}/sprites`,
    mbtiles: `${dataDir}/mbtiles`,
    pmtiles: `${dataDir}/pmtiles`,
    xyzs: `${dataDir}/xyzs`,
    caches: {
      fonts: `caches/${dataDir}/fonts`,
      styles: `caches/${dataDir}/styles`,
      sprites: `caches/${dataDir}/sprites`,
      mbtiles: `caches/${dataDir}/mbtiles`,
      pmtiles: `caches/${dataDir}/pmtiles`,
      xyzs: `caches/${dataDir}/xyzs`,
    },
  };

  config.repo = Object.fromEntries(
    ["styles", "rendereds", "datas", "fonts", "sprites"].map((type) => [
      type,
      {},
    ])
  );

  config.configFilePath = `${dataDir}/config.json`;
  config.seedFilePath = `${dataDir}/seed.json`;
  config.cleanUpFilePath = `${dataDir}/cleanup.json`;
  config.fallbackFont = "Open Sans Regular";
  config.startupComplete = false;
}

/**
 * Load seed.json file
 * @param {string} dataDir
 * @returns {Promise<void>}
 */
async function loadSeedFile(dataDir) {
  /* Read seed.json file */
  seed = JSON.parse(await fsPromise.readFile(`${dataDir}/seed.json`, "utf8"));

  /* Fix object */
  seed.tileLocks = {
    datas: Object.fromEntries(Object.keys(seed.datas).map((id) => [id, {}])),
    styles: Object.fromEntries(Object.keys(seed.styles).map((id) => [id, {}])),
    fonts: Object.fromEntries(Object.keys(seed.fonts).map((id) => [id, {}])),
    sprites: Object.fromEntries(
      Object.keys(seed.sprites).map((id) => [id, {}])
    ),
  };
}

/**
 * Load cleanup.json file
 * @param {string} dataDir
 * @returns {Promise<void>}
 */
async function loadCleanUpFile(dataDir) {
  /* Read cleanup.json file */
  cleanUp = JSON.parse(
    await fsPromise.readFile(`${dataDir}/cleanup.json`, "utf8")
  );
}

export { loadConfigFile, loadSeedFile, loadCleanUpFile, config, seed, cleanUp };
