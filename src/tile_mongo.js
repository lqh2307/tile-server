"use strict";

import fsPromise from "node:fs/promises";
import sqlite3 from "sqlite3";
import path from "node:path";

async function initializeTileMongoCollections(db) {
  const collections = await db
    .listCollections(
      {},
      {
        nameOnly: true,
      }
    )
    .toArray();

  const collectionNames = collections.map((col) => col.name);

  if (collectionNames.includes("metadata") === false) {
    await db.createCollection("metadata");

    await db.collection("metadata").createIndex(
      {
        name: 1,
      },
      {
        unique: true,
      }
    );
  }

  if (collectionNames.includes("tiles") === false) {
    await db.createCollection("tiles");

    await db.collection("tiles").createIndex(
      {
        zoom_level: 1,
        tile_column: 1,
        tile_row: 1,
      },
      {
        unique: true,
      }
    );
  }
}

/**
 * Open MBTiles database
 * @param {string} uri MongoDB connection string
 * @param {string} dbName Database name
 * @param {boolean} isCreate
 * @returns {Promise<object>}
 */
export async function openTileMongoCollections(uri, dbName, isCreate) {
  const tileMongoDBSource = await openMongoDB(uri, dbName);

  if (isCreate === true) {
    await initializeTileMongoCollections(tileMongoDBSource);
  }

  return tileMongoDBSource;
}

export async function upsertTileMongoMetadata(db, metadataAdds) {
  await Promise.all(
    Object.entries(metadataAdds).map(([key, value]) =>
      db.collection("metadata").updateOne(
        {
          name: key,
        },
        {
          $set: {
            value: JSON.stringify(value),
          },
        },
        {
          upsert: true,
        }
      )
    )
  );
}

export async function upsertTileMongoTile(db, z, x, y, hash, data) {
  await db.collection("tiles").updateOne(
    {
      zoom_level: z,
      tile_column: x,
      tile_row: (1 << z) - 1 - y,
    },
    {
      $set: {
        tile_data: data,
        hash: hash,
        created: Date.now(),
      },
    },
    {
      upsert: true,
    }
  );
}

export async function removeTileMongoTile(db, z, x, y) {
  await db.collection("tiles").deleteOne({
    zoom_level: z,
    tile_column: x,
    tile_row: (1 << z) - 1 - y,
  });
}

export async function getTileMongoMetadata(db) {
  const rows = await db.collection("metadata").find({}).toArray();

  const metadata = rows.reduce((acc, row) => {
    acc[row.name] = JSON.parse(row.value);
    return acc;
  }, {});

  return metadata;
}

export async function getTileMongoTile(db, z, x, y) {
  const tile = await db.collection("tiles").findOne({
    zoom_level: z,
    tile_column: x,
    tile_row: (1 << z) - 1 - y,
  });

  if (!tile) {
    throw new Error("Tile does not exist");
  }

  return {
    data: tile.tile_data,
    headers: detectFormatAndHeaders(tile.tile_data).headers,
  };
}
