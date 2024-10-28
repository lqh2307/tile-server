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
wget -q https://nodejs.org/download/release/v22.9.0/node-v22.9.0-linux-x64.tar.xz; \
mkdir -p /usr/local/lib/nodejs && tar -xJf node-v22.9.0-linux-x64.tar.xz --strip-components=1 -C /usr/local/lib/nodejs; \
rm -rf node-v22.9.0-linux-x64.tar.xz; \
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
    "maxPoolSize": 16
  },
  "styles": {
    "vietnam": {
      "style": "vietnam/style.json"
    },
    "cambodia": {
      "style": "cambodia/style.json"
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
    "osm-raster": {
      "xyz": "osm-raster"
    },
    "osm-vector": {
      "xyz": "osm-vector"
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
