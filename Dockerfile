# zcash-devtool provides the wallet backend (librustzcash) for view-only scanning.
FROM rust:1-bookworm AS devtool
RUN apt-get update && apt-get install -y protobuf-compiler && rm -rf /var/lib/apt/lists/*
ARG DEVTOOL_REV=0b3436bb8d235c67cd36b800cb45a7b1b489c415
RUN git clone https://github.com/zcash/zcash-devtool.git /src && cd /src && git checkout ${DEVTOOL_REV}
WORKDIR /src
RUN cargo build --release

FROM node:24-bookworm-slim
RUN apt-get update && apt-get install -y ca-certificates && rm -rf /var/lib/apt/lists/*
COPY --from=devtool /src/target/release/zcash-devtool /usr/local/bin/zcash-devtool
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --omit=dev
COPY . .
ENV DATA_DIR=/data WALLET_DIR=/data/wallet PORT=3000
EXPOSE 3000
CMD ["sh", "scripts/start.sh"]
