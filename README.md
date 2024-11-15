# Tile server

## Build & Run

### Prepare

Clone source:

```bash
git clone --single-branch -b 0.0.1 https://github.com/lqh2307/tile-server.git
```

Jump to folder:

```bash
cd tile-server
```

Switch to 0.0.1:

```bash
git checkout 0.0.1
```

If run on ubuntu:

```bash
apt-get -y update; \
apt-get -y upgrade; \
apt-get -y install \
  pkg-config \
  build-essential \
  ca-certificates \
  wget \
  xvfb \
  libglfw3-dev \
  libuv1-dev \
  libjpeg-turbo8-dev \
  libicu-dev \
  libopengl-dev \
  libgif-dev \
  libpng-dev \
  libwebp-dev \
  libcurl4-openssl-dev; \
apt-get -y --purge autoremove; \
apt-get clean; \
rm -rf /var/lib/apt/lists/*;
```

```bash
wget -q https://nodejs.org/download/release/v22.11.0/node-v22.11.0-linux-x64.tar.xz; \
mkdir -p /usr/local/lib/nodejs && tar -xJf node-v22.11.0-linux-x64.tar.xz --strip-components=1 -C /usr/local/lib/nodejs; \
rm -rf node-v22.11.0-linux-x64.tar.xz; \
echo 'export PATH=/usr/local/lib/nodejs/bin:$PATH' >> ~/.bashrc; \
source ~/.bashrc;
```

```bash
npm install -g yarn
```

### Run with nodejs

```bash
NODE_ENV=production yarn install; \
yarn run server -d path_to_data_folder
```

### Run with docker

Build image:

```bash
docker build -t tile-server:0.0.1 .
```

Run container:

```bash
docker run --rm -it -p 8080:8080 --name tile-server -v path_to_data_folder:/tile-server/data tile-server:0.0.1
```

## Example config.json

```json
{
  "options": {
    "listenPort": 8080,
    "killEndpoint": true,
    "restartEndpoint": true,
    "configEndpoint": true,
    "frontPage": true,
    "serveWMTS": true,
    "serveRendered": true,
    "maxScaleRender": 1,
    "renderedCompression": 6,
    "serveSwagger": true,
    "createMetadataIndex": false,
    "createTilesIndex": false,
    "loggerFormat": ":date[iso] [INFO] :method :url :status :res[content-length] :response-time :remote-addr :user-agent",
    "minPoolSize": 8,
    "maxPoolSize": 16,
    "taskSchedule": "0 0 0 * * *",
    "restartServerAfterTask": true,
    "killInterval": 0,
    "restartInterval": 0,
    "process": 1,
    "thread": 8
  },
  "styles": {
    "vietnam": {
      "style": "vietnam/style.json"
    },
    "cambodia": {
      "style": "cambodia/style.json",
      "cache": {
        "forward": true,
        "store": false
      }
    },
    "zurich_switzerland": {
      "style": "zurich_switzerland/style.json"
    }
  },
  "datas": {
    "asia_vietnam": {
      "mbtiles": "asia_vietnam/asia_vietnam.mbtiles"
    },
    "asia_cambodia": {
      "mbtiles": "asia_cambodia/asia_cambodia.mbtiles"
    },
    "planet": {
      "pmtiles": "https://data.source.coop/protomaps/openstreetmap/tiles/v3.pmtiles"
    },
    "building_footprints": {
      "pmtiles": "https://data.source.coop/vida/google-microsoft-open-buildings/pmtiles/go_ms_building_footprints.pmtiles"
    },
    "ODbL_firenze": {
      "pmtiles": "ODbL_firenze/ODbL_firenze.pmtiles"
    },
    "zurich_switzerland": {
      "mbtiles": "https://github.com/acalcutt/tileserver-gl/releases/download/test_data/zurich_switzerland.mbtiles"
    },
    "asia_vietnam_cache": {
      "xyz": "asia_vietnam_cache",
      "cache": {
        "forward": true,
        "store": true
      }
    },
    "asia_cambodia_cache": {
      "xyz": "asia_cambodia_cache",
      "cache": {
        "forward": true,
        "store": false
      }
    }
  },
  "sprites": {
    "liberty": true,
    "basic": true
  },
  "fonts": {
    "Open Sans Regular": true,
    "Times New Roman": true
  }
}
```

## Example seed.json

```json
{
  "styles": {
    "vietnam": {
      "url": "http://localhost:8080/styles/vietnam/style.json",
      "refreshBefore": {
        "time": "2024-10-10T00:00:00"
      }
    },
    "cambodia": {
      "metadata": {
        "name": "cambodia",
        "zoom": 10,
        "center": [120, 20, 3]
      },
      "url": "http://localhost:8080/styles/cambodia/style.json",
      "refreshBefore": {
        "time": "2024-10-10T00:00:00"
      }
    },
    "zurich_switzerland": {
      "url": "http://localhost:8080/styles/zurich_switzerland/style.json",
      "refreshBefore": {
        "time": "2024-10-10T00:00:00"
      }
    }
  },
  "datas": {
    "asia_vietnam_cache": {
      "metadata": {
        "name": "asia_vietnam",
        "description": "asia_vietnam",
        "format": "png",
        "bounds": [96, 4, 120, 28],
        "center": [108, 16, 10],
        "minzoom": 0,
        "maxzoom": 15
      },
      "url": "http://localhost:8080/datas/asia_vietnam/{z}/{x}/{y}.png",
      "bbox": [96, 4, 120, 28],
      "zooms": [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
      "refreshBefore": {
        "time": "2024-10-10T00:00:00"
      },
      "timeout": 60000,
      "concurrency": 100,
      "maxTry": 5
    },
    "asia_cambodia_cache": {
      "metadata": {
        "name": "asia_cambodia",
        "description": "asia_cambodia",
        "format": "pbf",
        "bounds": [96, 4, 120, 28],
        "center": [108, 16, 10],
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
      "url": "http://localhost:8080/datas/asia_cambodia/{z}/{x}/{y}.pbf",
      "bbox": [96, 4, 120, 28],
      "zooms": [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
      "refreshBefore": {
        "time": "2024-10-10T00:00:00"
      },
      "timeout": 60000,
      "concurrency": 100,
      "maxTry": 5
    }
  },
  "sprites": {
    "liberty": {
      "url": "http://localhost:8080/sprites/liberty/sprite",
      "refreshBefore": {
        "time": "2024-10-10T00:00:00"
      }
    },
    "basic": {
      "url": "http://localhost:8080/sprites/basic/sprite",
      "refreshBefore": {
        "time": "2024-10-10T00:00:00"
      }
    }
  },
  "fonts": {
    "Open Sans Regular": {
      "url": "http://localhost:8080/fonts/Open Sans Regular/{range}.pbf",
      "refreshBefore": {
        "time": "2024-10-10T00:00:00"
      }
    },
    "Times New Roman": {
      "url": "http://localhost:8080/fonts/Times New Roman/{range}.pbf",
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
    "vietnam": {
      "cleanUpBefore": {
        "time": "2024-10-10T00:00:00"
      }
    },
    "cambodia": {
      "cleanUpBefore": {
        "time": "2024-10-10T00:00:00"
      }
    },
    "zurich_switzerland": {
      "cleanUpBefore": {
        "time": "2024-10-10T00:00:00"
      }
    }
  },
  "datas": {
    "asia_vietnam_cache": {
      "cleanUpBefore": {
        "time": "2024-10-10T00:00:00"
      },
      "zooms": [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
      "bounds": [96, 4, 120, 28]
    },
    "asia_cambodia_cache": {
      "cleanUpBefore": {
        "time": "2024-10-10T00:00:00"
      },
      "zooms": [0, 1, 2, 3, 4, 5, 9, 10],
      "bounds": [96, 4, 120, 28]
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
