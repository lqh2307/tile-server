ARG BUILDER_IMAGE=ubuntu:22.04
ARG TARGET_IMAGE=ubuntu:22.04

FROM ${BUILDER_IMAGE} AS builder

RUN \
  export DEBIAN_FRONTEND=noninteractive; \
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

RUN \
  wget -q https://nodejs.org/download/release/v22.11.0/node-v22.11.0-linux-x64.tar.xz; \
  mkdir -p /usr/local/lib/nodejs && tar -xJf node-v22.11.0-linux-x64.tar.xz --strip-components=1 -C /usr/local/lib/nodejs; \
  rm -rf node-v22.11.0-linux-x64.tar.xz;

ENV PATH=/usr/local/lib/nodejs/bin:$PATH

WORKDIR /tile-server

ADD . .

RUN \
  npm install -g yarn; \
  NODE_ENV=production yarn install; \
  rm -rf yarn.lock;


FROM ${TARGET_IMAGE} AS final

ARG ENABLE_EXPORT=true

RUN \
  export DEBIAN_FRONTEND=noninteractive; \
  apt-get -y update; \
  apt-get -y upgrade; \
  apt-get -y install \
    xvfb \
    nginx \
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
    apt-get -y install gdal-bin; \
  fi;

RUN \
  apt-get -y --purge autoremove; \
  apt-get clean; \
  rm -rf /var/lib/apt/lists/*;

WORKDIR /tile-server

COPY --from=builder /tile-server .
COPY --from=builder /usr/local/lib/nodejs /usr/local/lib/nodejs
COPY --from=builder /tile-server/nginx.conf /etc/nginx/nginx.conf

ENV PATH=/usr/local/lib/nodejs/bin:$PATH
ENV ENABLE_EXPORT=${ENABLE_EXPORT}
ENV USE_NGINX=true

VOLUME /tile-server/data

EXPOSE 8080
EXPOSE 80

ENTRYPOINT ["./entrypoint.sh"]
