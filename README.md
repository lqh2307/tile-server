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
			"paths": {
				"fonts": "fonts",
				"sprites": "sprites",
				"styles": "styles",
				"mbtiles": "mbtiles",
				"pmtiles": "pmtiles"
			},
			"formatQuality": {
				"jpeg": 100,
				"webp": 100,
				"avif": 100
			},
			"listenPort": 8080,
			"watchToKill": 0,
			"watchToRestart": 1000,
			"killEndpoint": true,
			"restartEndpoint": true,
			"frontPage": true,
			"serveWMTS": true,
			"serveRendered": true,
			"maxScaleRender": 2,
			"minPoolSize": 8,
			"maxPoolSize": 16
		},
		"styles": {
			"osm-basic": {
				"style": "osm-basic/style.json"
			},
			"osm-positron": {
				"style": "osm-positron/style.json"
			},
			"osm-dark-matter": {
				"style": "osm-dark-matter/style.json"
			},
			"osm-fiord-color": {
				"style": "osm-fiord-color/style.json"
			},
			"osm-liberty": {
				"style": "osm-liberty/style.json"
			},
			"osm-terrain": {
				"style": "osm-terrain/style.json"
			},
			"osm-toner": {
				"style": "osm-toner/style.json"
			},
			"osm-bright": {
				"style": "osm-bright/style.json"
			},
			"osm-3d": {
				"style": "osm-3d/style.json"
			},
			"ncds_20c": {
				"style": "ncds_20c/style.json"
			},
			"zurich_switzerland": {
				"style": "zurich_switzerland/style.json"
			}
		},
		"data": {
			"asia_vietnam": {
				"mbtiles": "asia_vietnam.mbtiles"
			},
			"asia_cambodia": {
				"mbtiles": "asia_cambodia.mbtiles"
			},
			"ncds_20c": {
				"mbtiles": "ncds_20c.mbtiles"
			},
			"vietnam": {
				"mbtiles": "vietnam.mbtiles"
			},
			"planet": {
				"pmtiles": "https://data.source.coop/protomaps/openstreetmap/tiles/v3.pmtiles"
			},
			"protomaps_firenze": {
				"pmtiles": "https://open.gishub.org/data/pmtiles/protomaps_firenze.pmtiles"
			},
			"overture": {
				"pmtiles": "https://storage.googleapis.com/ahp-research/overture/pmtiles/overture.pmtiles"
			},
			"go_ms_building_footprints": {
				"pmtiles": "https://data.source.coop/vida/google-microsoft-open-buildings/pmtiles/go_ms_building_footprints.pmtiles"
			},
			"ODbL_firenze": {
				"pmtiles": "ODbL_firenze.pmtiles"
			},
			"zurich_switzerland": {
				"mbtiles": "https://github.com/acalcutt/tileserver-gl/releases/download/test_data/zurich_switzerland.mbtiles"
			}
		},
		"sprites": {
			"osm-liberty": true,
			"osm-basic": true
		},
		"fonts": {
			"Open Sans Regular": true,
			"Times New Roman": true
		}
	}
