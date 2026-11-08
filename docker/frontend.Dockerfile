FROM node:26-alpine AS build

WORKDIR /app
COPY package.json package-lock.json ./
COPY backend/package.json backend/package.json
COPY frontend/package.json frontend/package.json
RUN npm ci
COPY frontend frontend
# Optional: a Cloudflare Web Analytics site token, which the build writes into the page's script.
ARG VITE_CLOUDFLARE_WEB_ANALYTICS_TOKEN=
# Optional: what a shared link shows (frontend/sharePreview.ts). The origin makes the preview image's address absolute.
ARG SITE_ORIGIN=
ARG SITE_TITLE=
ARG SITE_DESCRIPTION=
RUN npm run build --workspace frontend

FROM nginx:1.30-alpine

COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/frontend/dist /usr/share/nginx/html
EXPOSE 80
