# Tile server

## Build & Run

### Prepare

Clone source:

```bash
git clone --single-branch -b 0.0.18 https://github.com/lqh2307/tile-server.git
```

Jump to folder:

```bash
cd tile-server
```

Switch to 0.0.18 branch:

```bash
git checkout 0.0.18
```

### Run with nodejs (on ubuntu 22.04 x86_64 amd)

Install dependencies:

```bash
apt-get -y update; \
apt-get -y upgrade; \
apt-get -y install \
  ca-certificates \
  wget \
  xvfb \
  libglfw3 \
  libuv1 \
  libjpeg-turbo8 \
  libicu70 \
  libgif7 \
  libopengl0 \
  libpng16-16 \
  libwebp7 \
  libsqlite3-0 \
  libcurl4;
```

If use export (Install gdal):

```bash
export GDAL_VERSION=3.10.2

wget -q http://download.osgeo.org/gdal/${GDAL_VERSION}/gdal-${GDAL_VERSION}.tar.gz; \
tar -xzf ./gdal-${GDAL_VERSION}.tar.gz; \
cd ./gdal-${GDAL_VERSION}; \
mkdir -p build; \
cd build; \
cmake .. -DCMAKE_BUILD_TYPE=Release; \
cmake --build .; \
cmake --build . --target install; \
cd ../..; \
rm -rf ./gdal-${GDAL_VERSION}*; \
ldconfig;
```

Install nodejs:

```bash
export NODEJS_VERSION=22.14.0

wget -q https://nodejs.org/download/release/v${NODEJS_VERSION}/node-v${NODEJS_VERSION}-linux-x64.tar.gz; \
mkdir -p /usr/local/lib/nodejs; \
tar -xzf node-v${NODEJS_VERSION}-linux-x64.tar.gz --strip-components=1 -C /usr/local/lib/nodejs; \
rm -rf node-v${NODEJS_VERSION}-linux-x64.tar.gz; \
echo 'export PATH=/usr/local/lib/nodejs/bin:$PATH' >> ~/.bashrc; \
source ~/.bashrc;
```

Clean:

```bash
apt-get -y remove \
  ca-certificates \
  wget;
apt-get -y --purge autoremove; \
apt-get clean; \
rm -rf /var/lib/apt/lists/*;
```

Install nodejs packages:

```bash
npm install --omit=dev
```

Run:

```bash
npm run server -- -d path_to_data_folder
```

### Run with docker

Build image:

```bash
docker build -t tile-server:0.0.18 .
```

Run container:

```bash
docker run --rm -it -p 8080:8080 --name tile-server -v path_to_data_folder:/tile-server/data tile-server:0.0.18
```

## Example config.json

```json
{
  "options": {
    "listenPort": 8080,
    "serveFrontPage": true,
    "serveSwagger": true,
    "loggerFormat": ":date[iso] [INFO] :method :url :status :res[content-length] :response-time :remote-addr :user-agent",
    "taskSchedule": "0 0 0 * * *",
    "postgreSQLBaseURI": "postgresql://localhost:5432",
    "process": 1,
    "thread": 8
  },
  "styles": {
    "asia_vietnam": {
      "style": "asia_vietnam/style.json",
      "rendered": {
        "compressionLevel": 9
      }
    },
    "asia_cambodia": {
      "style": "asia_cambodia",
      "cache": {
        "forward": true,
        "store": true
      }
    },
    "zurich_switzerland": {
      "style": "zurich_switzerland/style.json"
    }
  },
  "geojsons": {
    "asia_vietnam_geojson": {
      "asia_vietnam_geojson": {
        "geojson": "asia_vietnam_geojson/geojson.geojson"
      }
    },
    "asia_cambodia_geojson": {
      "asia_cambodia_geojson": {
        "geojson": "asia_cambodia_geojson",
        "cache": {
          "forward": true,
          "store": true
        }
      }
    }
  },
  "datas": {
    "asia_china": {
      "mbtiles": "asia_vietnam/asia_vietnam.mbtiles"
    },
    "asia_korea": {
      "pmtiles": "asia_korea/asia_korea.pmtiles"
    },
    "asia_myanmar": {
      "pmtiles": "http://localhost:9999/datas/asia_myanmar.pmtiles"
    },
    "asia_japan": {
      "mbtiles": "http://localhost:9999/datas/asia_japan.mbtiles"
    },
    "zurich_switzerland": {
      "mbtiles": "zurich_switzerland_cache",
      "cache": {
        "forward": false,
        "store": false
      }
    },
    "asia_vietnam": {
      "mbtiles": "asia_vietnam_cache",
      "cache": {
        "forward": true,
        "store": true
      }
    },
    "asia_cambodia": {
      "xyz": "asia_cambodia_cache",
      "cache": {
        "forward": true,
        "store": false
      }
    }
  },
  "sprites": {
    "liberty": {
      "sprite": "liberty"
    },
    "basic": {
      "sprite": "basic"
    }
  },
  "fonts": {
    "Open Sans Regular": {
      "font": "Open Sans Regular"
    },
    "Times New Roman": {
      "font": "Times New Roman"
    }
  }
}
```

## Example seed.json

```json
{
  "styles": {
    "asia_cambodia": {
      "metadata": {
        "name": "asia_cambodia",
        "zoom": 10,
        "center": [
          120,
          20,
          3
        ]
      },
      "url": "http://localhost:9999/styles/asia_cambodia/style.json",
      "refreshBefore": {
        "day": 2
      }
    }
  },
  "geojsons": {
    "asia_cambodia_geojson": {
      "metadata": {
        "name": "asia_cambodia"
      },
      "url": "http://localhost:9999/geojsons/asia_cambodia/geojson.geojson",
      "refreshBefore": {
        "day": 2
      }
    }
  },
  "datas": {
    "asia_vietnam_cache": {
      "metadata": {
        "name": "asia_vietnam",
        "description": "asia_vietnam",
        "format": "png",
        "bounds": [
          96,
          4,
          120,
          28
        ],
        "center": [
          108,
          16,
          10,
        ],
        "minzoom": 0,
        "maxzoom": 15
      },
      "url": "http://localhost:9999/datas/asia_vietnam/{z}/{x}/{y}.png",
      "bboxs": [
        [
          96,
          4,
          120,
          28
        ]
      ],
      "zooms": [
        0,
        1,
        2,
        3,
        4,
        5,
        6,
        7,
        8,
        9,
        10
      ],
      "refreshBefore": {
        "time": "2024-10-10T00:00:00"
      },
      "storeType": "mbtiles",
      "storeTransparent": true,
      "storeMD5": true,
      "timeout": 60000,
      "concurrency": 100,
      "maxTry": 5
    },
    "asia_cambodia_cache": {
      "metadata": {
        "name": "asia_cambodia",
        "description": "asia_cambodia",
        "format": "pbf",
        "bounds": [
          96,
          4,
          120,
          28
        ],
        "center": [
          108,
          16,
          10,
        ],
        "minzoom": 0,
        "maxzoom": 15,
        "vector_layers": [
          {
            "id": "landuse"
          },
          {
            "id": "waterway"
          }
        ]
      },
      "url": "http://localhost:9999/datas/asia_cambodia/{z}/{x}/{y}.pbf",
      "bboxs": [
        [
          96,
          4,
          120,
          28
        ]
      ],
      "zooms": [
        0,
        1,
        2,
        3,
        4,
        5,
        6,
        7,
        8,
        9,
        10
      ],
      "refreshBefore": {
        "day": 2
      },
      "storeType": "xyz",
      "storeTransparent": false,
      "storeMD5": true,
      "timeout": 60000,
      "concurrency": 100,
      "maxTry": 5,
      "skip": true
    },
    "zurich_switzerland_cache": {
      "metadata": {
        "name": "zurich_switzerland",
        "description": "zurich_switzerland",
        "format": "pbf",
        "bounds": [
          96,
          4,
          120,
          28
        ],
        "center": [
          108,
          16,
          10,
        ],
        "minzoom": 0,
        "maxzoom": 15,
        "vector_layers": [
          {
            "id": "landuse"
          },
          {
            "id": "waterway"
          }
        ]
      },
      "url": "http://localhost:9999/datas/zurich_switzerland/{z}/{x}/{y}.pbf",
      "bboxs": [
        [
          96,
          4,
          120,
          28
        ]
      ],
      "zooms": [
        0,
        1,
        2,
        3,
        4,
        5,
        6,
        7,
        8,
        9,
        10
      ],
      "refreshBefore": {
        "md5": true
      },
      "storeType": "mbtiles",
      "storeTransparent": false,
      "storeMD5": true,
      "timeout": 60000,
      "concurrency": 100,
      "maxTry": 5
    }
  },
  "sprites": {
    "liberty": {
      "url": "http://localhost:9999/sprites/liberty/sprite",
      "refreshBefore": {
        "time": "2024-10-10T00:00:00"
      }
    },
    "basic": {
      "url": "http://localhost:9999/sprites/basic/sprite",
      "refreshBefore": {
        "time": "2024-10-10T00:00:00"
      }
    }
  },
  "fonts": {
    "Open Sans Regular": {
      "url": "http://localhost:9999/fonts/Open Sans Regular/{range}.pbf",
      "concurrency": 100,
      "refreshBefore": {
        "time": "2024-10-10T00:00:00"
      }
    },
    "Times New Roman": {
      "url": "http://localhost:9999/fonts/Times New Roman/{range}.pbf",
      "concurrency": 100,
      "refreshBefore": {
        "time": "2024-10-10T00:00:00"
      }
    }
  }
}
```

## Example cleanup.json

```json
{
  "styles": {
    "asia_vietnam": {
      "cleanUpBefore": {
        "time": "2024-10-10T00:00:00"
      }
    },
    "asia_cambodia": {
      "cleanUpBefore": {
        "day": 2
      },
      "skip": true
    },
    "zurich_switzerland": {
      "cleanUpBefore": {
        "day": 3
      }
    }
  },
  "geojsons": {
    "asia_cambodia_geojson": {
      "cleanUpBefore": {
        "day": 2
      },
      "skip": true
    }
  },
  "datas": {
    "asia_vietnam_cache": {
      "cleanUpBefore": {
        "time": "2024-10-10T00:00:00"
      },
      "zooms": [
        0,
        1,
        2,
        3,
        4,
        5,
        6,
        7,
        8,
        9,
        10
      ],
      "bboxs": [
        [
          96,
          4,
          120,
          28
        ]
      ],
    },
    "asia_cambodia_cache": {
      "cleanUpBefore": {
        "day": 2
      },
      "zooms": [
        0,
        1,
        2,
        3,
        4,
        5,
        9,
        10
      ],
      "bboxs": [
        [
          96,
          4,
          120,
          28
        ]
      ],
    },
    "zurich_switzerland_cache": {
      "cleanUpBefore": {
        "day": 3
      },
      "zooms": [
        10
      ],
      "bboxs": [
        [
          96,
          4,
          120,
          28
        ]
      ],
    }
  },
  "sprites": {
    "liberty": {
      "cleanUpBefore": {
        "time": "2024-10-10T00:00:00"
      }
    },
    "basic": {
      "cleanUpBefore": {
        "time": "2024-10-10T00:00:00"
      }
    }
  },
  "fonts": {
    "Open Sans Regular": {
      "cleanUpBefore": {
        "time": "2024-10-10T00:00:00"
      }
    },
    "Times New Roman": {
      "cleanUpBefore": {
        "time": "2024-10-10T00:00:00"
      }
    }
  }
}
```
