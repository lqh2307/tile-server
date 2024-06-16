===== Tile server =====

## Build & Run

Clone source:

	git clone https://github.com/lqh2307/tile-server.git

Chuyển sang nhánh dev:

	git checkout dev

Build image:

	docker build -t quanghuy2307/tile-server:latest .

Run container:

	docker run --rm -it -p 8080:8080 --name tile-server -v /home/huy/Downloads/tile-server/data:/tile-server/data quanghuy2307/tile-server:latest -r 1000
