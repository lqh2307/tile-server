ARG BUILDER_IMAGE=ubuntu:22.04
ARG TARGET_IMAGE=ubuntu:22.04

FROM $BUILDER_IMAGE AS builder

# set proxy
# ARG http_proxy=http://10.55.123.98:3333
# ARG https_proxy=http://10.55.123.98:3333

USER root

RUN \
  set -ex; \
  export DEBIAN_FRONTEND=noninteractive; \
  apt-get -qq update; \
  apt-get -y --no-install-recommends install \
  build-essential \
  ca-certificates \
  wget \
  xvfb \
  libglfw3-dev \
  libuv1-dev \
  libjpeg-turbo8 \
  libicu70 \
  libcairo2-dev \
  libpango1.0-dev \
  libjpeg-dev \
  libgif-dev \
  librsvg2-dev \
  gir1.2-rsvg-2.0 \
  librsvg2-2 \
  librsvg2-common \
  libcurl4-openssl-dev \
  libpixman-1-dev \
  libpixman-1-0;

RUN \
  wget -c https://nodejs.org/dist/v20.14.0/node-v20.14.0-linux-x64.tar.xz; \
  tar -xvf node-v20.14.0-linux-x64.tar.xz; \
  cp -r node-v20.14.0-linux-x64/bin node-v20.14.0-linux-x64/include node-v20.14.0-linux-x64/lib node-v20.14.0-linux-x64/share /usr/; \
  apt-get -y --purge autoremove; \
  apt-get clean; \
  rm -rf /var/lib/apt/lists/* node-v20.14.0-linux-x64*;

WORKDIR /tile-server

ADD . .

RUN npm install --omit=dev;


FROM $TARGET_IMAGE AS final

USER root

# set proxy
# ARG http_proxy=http://10.55.123.98:3333
# ARG https_proxy=http://10.55.123.98:3333

RUN \
  set -ex; \
  export DEBIAN_FRONTEND=noninteractive; \
  apt-get -qq update; \
  apt-get -y --no-install-recommends install \
  xvfb \
  libglfw3 \
  libuv1 \
  libjpeg-turbo8 \
  libicu70 \
  libcairo2 \
  libgif7 \
  libopengl0 \
  libpixman-1-0 \
  libcurl4 \
  librsvg2-2 \
  libpango-1.0-0; \
  apt-get -y --purge autoremove; \
  apt-get clean; \
  rm -rf /var/lib/apt/lists/*;

COPY --from=builder /tile-server /tile-server
COPY --from=builder /usr/bin/node /usr/bin/node
COPY --from=builder /usr/include/node /usr/include/node
COPY --from=builder /usr/share/doc/node /usr/share/doc/node

WORKDIR /tile-server

VOLUME /tile-server/data

EXPOSE 8080

ENTRYPOINT ["./docker-entrypoint.sh"]
