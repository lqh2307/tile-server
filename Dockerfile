FROM ubuntu:22.04 AS builder

RUN \
  set -ex; \
  export DEBIAN_FRONTEND=noninteractive; \
  apt-get -qq update; \
  apt-get -y --no-install-recommends install \
  pkg-config \
  build-essential \
  ca-certificates \
  curl \
  gnupg \
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

WORKDIR /tile-server

COPY . .

RUN \
  mkdir -p /etc/apt/keyrings; \
  curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg; \
  echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_20.x nodistro main" | tee /etc/apt/sources.list.d/nodesource.list; \
  apt-get -qq update; \
  apt-get install -y nodejs; \
  npm install --omit=dev;


FROM ubuntu:22.04 AS final

RUN \
  set -ex; \
  export DEBIAN_FRONTEND=noninteractive; \
  apt-get -qq update; \
  apt-get -y --no-install-recommends install \
  ca-certificates \
  curl \
  gnupg \
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
  libpango-1.0-0;

USER root

WORKDIR /tile-server

COPY --from=builder /tile-server .

RUN \
  mkdir -p /etc/apt/keyrings; \
  curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg; \
  echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_20.x nodistro main" | tee /etc/apt/sources.list.d/nodesource.list; \
  apt-get -qq update; \
  apt-get install -y nodejs; \
  apt-get -y remove curl gnupg; \
  apt-get -y --purge autoremove; \
  apt-get clean; \
  rm -rf /var/lib/apt/lists/*; \
  mv ./data_template ./data;

VOLUME /tile-server/data

EXPOSE 8080

ENTRYPOINT ["./docker-entrypoint.sh"]
