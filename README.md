# Tile server

## Build & Run

### Prepare

Clone source:

	git clone --single-branch -b 1.0.0 https://github.com/lqh2307/tile-server.git

Jump to folder:

	cd tile-server

Switch to 1.0.0:

	git checkout 1.0.0

### Run with nodejs

	npm run start -- -d path_to_data_folder

### Run with docker

Build image:

	docker build -t tile-server:1.0.0 .

Run container:

	docker run --rm -it -p 8080:8080 --name tile-server -v path_to_data_folder:/tile-server/data tile-server:1.0.0

## Example config.json

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
	  "data": {
	    "maptiler-osm-2020-02-10-v3.11-asia_vietnam": {
	      "mbtiles": "https://data.maptiler.com/download/WyI4ZGYyNjRmMi0yNmMzLTRmZTMtOWFjMS1kNDkyMGJkYWRmYzIiLCItMSIsMTcwMDld.ZsnBRw.ncIEITZnE-OUjfCpaLqiqPQv4sw/maptiler-osm-2020-02-10-v3.11-asia_vietnam.mbtiles"
	    },
	    "maptiler-osm-2020-02-10-v3.11-asia_cambodia": {
	      "mbtiles": "https://data.maptiler.com/download/WyI4ZGYyNjRmMi0yNmMzLTRmZTMtOWFjMS1kNDkyMGJkYWRmYzIiLCItMSIsMTY5Mjld.ZsngxA.VwWB3Ja4Tzb_haPX1lbrG9-hqOY/maptiler-osm-2020-02-10-v3.11-asia_cambodia.mbtiles"
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
