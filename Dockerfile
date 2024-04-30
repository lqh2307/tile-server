FROM ubuntu:22.04

WORKDIR /tile-server

RUN \
  apt update; \
  apt -y install \
    build-essential \
    ca-certificates \
    curl \
    gnupg \
    xvfb \
    pkg-config \
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
  mkdir -p /etc/apt/keyrings; \
  curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg; \
  echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_20.x nodistro main" | tee /etc/apt/sources.list.d/nodesource.list; \
  apt update; \
  apt install -y nodejs; \
  npm install npm@latest; \
  apt -y remove curl gnupg; \
  apt -y --purge autoremove; \
  apt clean; \
  rm -rf /var/lib/apt/lists/*;

COPY ./public ./public
COPY ./src ./src
COPY ./docker-entrypoint.sh ./docker-entrypoint.sh
COPY ./package.json ./package.json
COPY ./template/data ./data

RUN \
  npm install --omit=dev; \
  npm cache clean --force; \
  chmod -R +x .;

ENTRYPOINT ["./docker-entrypoint.sh"]
