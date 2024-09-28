ARG BUILDER_IMAGE=ubuntu:22.04
ARG TARGET_IMAGE=ubuntu:22.04

FROM ${BUILDER_IMAGE} AS builder

RUN \
  set -ex; \
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
  wget -q https://nodejs.org/download/release/v22.9.0/node-v22.9.0-linux-x64.tar.xz; \
  mkdir -p /usr/local/lib/nodejs && tar -xJf node-v22.9.0-linux-x64.tar.xz --strip-components=1 -C /usr/local/lib/nodejs; \
  echo 'export PATH=/usr/local/lib/nodejs/bin:$PATH' >> ~/.bashrc && source ~/.bashrc; \
  rm -rf node-v22.9.0-linux-x64.tar.xz;

WORKDIR /tile-server

ADD . .

RUN npm install --omit=dev;


FROM ${TARGET_IMAGE} AS final

RUN \
  set -ex; \
  export DEBIAN_FRONTEND=noninteractive; \
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
    libcurl4 && \
  apt-get -y --purge autoremove; \
  apt-get clean; \
  rm -rf /var/lib/apt/lists/*;

WORKDIR /tile-server

COPY --from=builder /tile-server .
COPY --from=builder /tile-server/public/resources/template ./data
COPY --from=builder /usr/local/lib/nodejs /usr/local/lib/nodejs

RUN echo 'export PATH=/usr/local/lib/nodejs/bin:$PATH' >> ~/.bashrc && source ~/.bashrc;

VOLUME /tile-server/data

EXPOSE 8080

ENTRYPOINT ["./entrypoint.sh"]
