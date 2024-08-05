ARG BUILDER_IMAGE=ubuntu:22.04
ARG TARGET_IMAGE=ubuntu:22.04

FROM $BUILDER_IMAGE AS builder

RUN \
  set -ex; \
  export DEBIAN_FRONTEND=noninteractive; \
  apt-get -qq update; \
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

RUN \
  wget -c https://nodejs.org/dist/v20.14.0/node-v20.14.0-linux-x64.tar.xz; \
  tar -xvf node-v20.14.0-linux-x64.tar.xz; \
  cp -r node-v20.14.0-linux-x64/bin node-v20.14.0-linux-x64/include node-v20.14.0-linux-x64/lib node-v20.14.0-linux-x64/share /usr/; \
  npm i npm@latest; \
  rm -rf node-v20.14.0-linux-x64*;

WORKDIR /tile-server

ADD . .

RUN npm install --omit=dev;


FROM $TARGET_IMAGE AS final

RUN \
  set -ex; \
  export DEBIAN_FRONTEND=noninteractive; \
  apt-get -qq update; \
  apt-get -y install \
  xvfb \
  libglfw3 \
  libuv1 \
  libjpeg-turbo8 \
  libicu70 \
  libgif7 \
  libopengl0 \
  libpng16-16 \
  libwebp7 \
  libcurl4; \
  apt-get -y --purge autoremove; \
  apt-get clean; \
  rm -rf /var/lib/apt/lists/*;

WORKDIR /tile-server

COPY --from=builder /tile-server .
COPY --from=builder /tile-server/public/resources/template ./data
COPY --from=builder /usr/bin/node /usr/bin/node
COPY --from=builder /usr/include/node /usr/include/node
COPY --from=builder /usr/share/doc/node /usr/share/doc/node

VOLUME /tile-server/data

EXPOSE 8080

ENTRYPOINT ["./entrypoint.sh"]
