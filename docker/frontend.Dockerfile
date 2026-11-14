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
# The derby's wasm and models, about 21 MB, compressed once here instead of on every request (docker/nginx.conf serves
# the `.br` or `.gz` file beside each). Brotli at its best level takes about a minute for all of them.
RUN apk add --no-cache brotli \
  && find frontend/dist/assets -type f \( -name '*.wasm' -o -name '*.task' -o -name '*.tflite' \) \
    -exec gzip -9 -k {} \; -exec brotli -q 11 -k {} \;

FROM nginx:1.30-alpine

COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/frontend/dist /usr/share/nginx/html
EXPOSE 80
