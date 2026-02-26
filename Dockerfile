# Render: use when Runtime = Docker. Builds app and runs server.
FROM node:18-bookworm

# Build tools for native modules (better-sqlite3-with-prebuilds)
RUN apt-get update -qq && apt-get install -y --no-install-recommends \
    python3 make g++ build-essential \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN NODE_OPTIONS=--max-old-space-size=4096 npm run build

ENV NODE_ENV=production
EXPOSE 10000

# Render sets PORT at runtime
CMD ["node", "server/index.js"]
