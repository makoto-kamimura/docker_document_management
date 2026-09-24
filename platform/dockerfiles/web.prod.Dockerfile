# ---- Build stage ----
FROM node:20-alpine AS builder
WORKDIR /app

# VITE_API_BASE_URL はビルド時に静的ファイルへ埋め込まれる
ARG VITE_API_BASE_URL=https://document.makoto-kamimura.com
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL

COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# ---- Serve stage ----
FROM nginx:alpine
COPY --from=builder /app/dist /usr/share/nginx/html

# SPA ルーティング: 存在しないパスは index.html にフォールバック
RUN printf 'server {\n    listen 80;\n    root /usr/share/nginx/html;\n    index index.html;\n    location / {\n        try_files $uri $uri/ /index.html;\n    }\n}\n' \
    > /etc/nginx/conf.d/default.conf

EXPOSE 80
