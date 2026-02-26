# Render: use this if Native Node deploy keeps failing (better-sqlite3 compile).
# In Dashboard set Runtime to "Docker" and leave Dockerfile path blank (uses ./Dockerfile).
FROM node:18-bookworm-slim

# Build tools for native modules (better-sqlite3-with-prebuilds fallback compile)
RUN apt-get update -qq && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN NODE_OPTIONS=--max-old-space-size=4096 npm run build

ENV NODE_ENV=production
EXPOSE 10000

CMD ["node", "server/index.js"]
