ARG BUILDER_IMAGE=ubuntu:22.04
ARG TARGET_IMAGE=ubuntu:22.04

FROM ${BUILDER_IMAGE} AS builder

ARG ENABLE_EXPORT=true
ARG GDAL_VERSION=3.10.2
ARG NODEJS_VERSION=22.14.0

RUN \
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
    libcurl4-openssl-dev;

RUN \
  if [ "${ENABLE_EXPORT}" = "true" ]; then \
    apt-get -y install \
      libproj-dev; \
    wget -q http://download.osgeo.org/gdal/${GDAL_VERSION}/gdal-${GDAL_VERSION}.tar.xz; \
    tar -xJf ./gdal-${GDAL_VERSION}.tar.xz; \
    cd ./gdal-${GDAL_VERSION}; \
    mkdir -p build; \
    cd build; \
    cmake .. -DCMAKE_BUILD_TYPE=Release; \
    cmake --build .; \
    cmake --build . --target install; \
    cd ../..;
    rm -rf ./gdal-${GDAL_VERSION}*; \
  fi;

RUN \
  apt-get -y --purge autoremove; \
  apt-get clean; \
  rm -rf /var/lib/apt/lists/*;

RUN \
  wget -q https://nodejs.org/download/release/v${NODEJS_VERSION}/node-v${NODEJS_VERSION}-linux-x64.tar.xz; \
  mkdir -p /usr/local/lib/nodejs; \
  tar -xJf node-v${NODEJS_VERSION}-linux-x64.tar.xz --strip-components=1 -C /usr/local/lib/nodejs; \
  rm -rf node-v${NODEJS_VERSION}-linux-x64.tar.xz;

WORKDIR /tile-server

ADD . .

RUN \
  npm install -g yarn; \
  NODE_ENV=production yarn install; \
  rm -rf yarn.lock;


FROM ${TARGET_IMAGE} AS final

ARG ENABLE_EXPORT=true

RUN \
  apt-get -y update; \
  apt-get -y upgrade; \
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
    libcurl4;

RUN \
  if [ "${ENABLE_EXPORT}" = "true" ]; then \
    apt-get -y install \
      libproj22; \
  fi;

RUN \
  apt-get -y --purge autoremove; \
  apt-get clean; \
  rm -rf /var/lib/apt/lists/*;

WORKDIR /tile-server

COPY --from=builder /tile-server .
COPY --from=builder /usr/local /usr/local

ENV PATH=/usr/local/lib/nodejs/bin:$PATH
ENV ENABLE_EXPORT=${ENABLE_EXPORT}

RUN \
  ldconfig;

VOLUME /tile-server/data

EXPOSE 8080

ENTRYPOINT ["./entrypoint.sh"]
