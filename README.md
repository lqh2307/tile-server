===== Tile server =====

## Build & Run

Clone source:

	git clone https://github.com/lqh2307/tile-server.git

Switch to 1.0.0:

	git checkout 1.0.0

Build image:

	docker build -t tile-server:1.0.0 .

Create data folder in local with structure:

	data_folder
		- fonts folder
		- mbtiles folder
		- pmtiles folder
		- sprites folder
		- styles folder
		- config.json file

Run container:

	docker run --rm -it -p 8080:8080 --name tile-server -v /path_to_data_folder:/tile-server/data tile-server:1.0.0

Example config.json content:

	{
		"options": {
			"listenPort": 8080,
			"watchToKill": 0,
			"watchToRestart": 1000,
			"killEndpoint": true,
			"restartEndpoint": true,
			"frontPage": true,
			"serveWMTS": true,
			"serveRendered": true,
			"maxScaleRender": 2,
			"renderedCompression": 6,
			"serveSwagger": true,
			"loggerFormat": ":date[iso] [INFO] :method :url :status :res[content-length] :response-time :remote-addr :user-agent",
			"minPoolSize": 8,
			"maxPoolSize": 16
		},
		"styles": {
			"basic": {
				"style": "basic/style.json"
			},
			"positron": {
				"style": "positron/style.json"
			},
			"dark-matter": {
				"style": "dark-matter/style.json"
			},
			"fiord-color": {
				"style": "fiord-color/style.json"
			},
			"liberty": {
				"style": "liberty/style.json"
			},
			"terrain": {
				"style": "terrain/style.json"
			},
			"toner": {
				"style": "toner/style.json"
			},
			"bright": {
				"style": "bright/style.json"
			},
			"3d": {
				"style": "3d/style.json"
			},
			"ncds_20c": {
				"style": "ncds_20c/style.json"
			},
			"zurich_switzerland": {
				"style": "zurich_switzerland/style.json"
			}
		},
		"data": {
			"maptiler-osm-2020-02-10-v3.11-asia_vietnam": {
				"mbtiles": "https://data.maptiler.com/download/WyI4ZGYyNjRmMi0yNmMzLTRmZTMtOWFjMS1kNDkyMGJkYWRmYzIiLCItMSIsMTcwMDld.ZsnBRw.ncIEITZnE-OUjfCpaLqiqPQv4sw/maptiler-osm-2020-02-10-v3.11-asia_vietnam.mbtiles"
			},
			"maptiler-osm-2020-02-10-v3.11-asia_cambodia.mbtiles": {
				"mbtiles": "https://data.maptiler.com/download/WyI4ZGYyNjRmMi0yNmMzLTRmZTMtOWFjMS1kNDkyMGJkYWRmYzIiLCItMSIsMTY5Mjld.ZsngxA.VwWB3Ja4Tzb_haPX1lbrG9-hqOY/maptiler-osm-2020-02-10-v3.11-asia_cambodia.mbtiles"
			},
			"ncds_20c": {
				"mbtiles": "ncds_20c/ncds_20c.mbtiles"
			},
			"planet": {
				"pmtiles": "https://data.source.coop/protomaps/openstreetmap/tiles/v3.pmtiles"
			},
			"protomaps_firenze": {
				"pmtiles": "https://open.gishub.org/data/pmtiles/protomaps_firenze.pmtiles"
			},
			"go_ms_building_footprints": {
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
