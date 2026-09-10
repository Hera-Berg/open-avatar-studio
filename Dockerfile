# open-avatar-studio
#
# Build stage: install + build everything (stage, control, server).
FROM node:20-alpine AS build
WORKDIR /app
# Workspace manifests must exist before `npm ci`, or npm installs only the
# root project (and skips vite/react + the @oar workspace packages).
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/package.json
COPY packages/player/package.json packages/player/package.json
COPY packages/stage/package.json packages/stage/package.json
COPY packages/control/package.json packages/control/package.json
COPY server/package.json server/package.json
RUN npm ci
COPY . .
RUN npm run build

# Runtime: only the bundled server + its prod deps + an empty data dir.
FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
# server/package.json makes npm see the @oar/server workspace (ws is a prod dep).
COPY server/package.json server/package.json
RUN npm ci --omit=dev
COPY --from=build /app/server/dist ./server/dist
RUN mkdir -p /app/data/models /app/data/backgrounds
ENV PORT=3100 DATA_DIR=/app/data
EXPOSE 3100
CMD ["node", "server/dist/server.js"]
