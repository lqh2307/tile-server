"use strict";

import { downloadTileDataFilesFromBBox, printLog } from "./utils.js";

/**
 * Start run seed data
 * @returns {Promise<void>}
 */
export async function startRunSeedData() {
  try {
    printLog("info", `Seeding data...`);

    // Seed vector
    await downloadTileDataFilesFromBBox(
      "https://tile.openstreetmap.org/{z}/{x}/{y}.pbf",
      "datatest/xyzs/osm-vector",
      [96, 4, 120, 28],
      0,
      10,
      "xyz",
      32,
      false,
      5,
      60000 // 1 min
    );

    // Seed raster
    await downloadTileDataFilesFromBBox(
      "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
      "datatest/xyzs/osm-raster",
      [96, 4, 120, 28],
      0,
      10,
      "xyz",
      32,
      false,
      5,
      60000 // 1 min
    );
  } catch (error) {
    printLog("error", `Failed seed data: ${error}. Exited!`);
  }
}
