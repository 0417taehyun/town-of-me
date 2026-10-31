FROM node:26-alpine AS build

WORKDIR /app
COPY package.json package-lock.json ./
COPY backend/package.json backend/package.json
COPY frontend/package.json frontend/package.json
RUN npm ci
COPY backend backend
RUN npm run build --workspace backend
RUN npm prune --omit=dev --workspace backend --include-workspace-root

FROM node:26-alpine

ENV HOST=0.0.0.0 NODE_ENV=production PORT=3000
WORKDIR /app
COPY --from=build /app/backend/dist backend/dist
COPY backend/server.mjs backend/server.mjs
COPY backend/migrations backend/migrations
COPY backend/seed backend/seed
COPY --from=build /app/node_modules node_modules
USER node
EXPOSE 3000
CMD ["node", "backend/server.mjs"]
