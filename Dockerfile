# syntax=docker/dockerfile:1.7

ARG NODE_VERSION=22-bookworm-slim
ARG NGINX_VERSION=1.27-alpine

FROM node:${NODE_VERSION} AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@9.14.2 --activate
WORKDIR /app

FROM base AS deps
ENV NODE_ENV=development
# Prisma config requires DATABASE_URL to exist while installing/generating.
ENV DATABASE_URL=postgresql://payincus:payincus@postgres:5432/payincus
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY server/package.json ./server/package.json
COPY server/prisma.config.ts ./server/prisma.config.ts
COPY server/prisma ./server/prisma
COPY client/package.json ./client/package.json
RUN pnpm install --frozen-lockfile

FROM deps AS build
ARG VITE_API_BASE_URL=/api
ARG VITE_CUSTOMER_BASE_URL=http://localhost:8080
ARG VITE_ADMIN_BASE_URL=http://localhost:8081
ENV VITE_API_BASE_URL=${VITE_API_BASE_URL}
ENV VITE_CUSTOMER_BASE_URL=${VITE_CUSTOMER_BASE_URL}
ENV VITE_ADMIN_BASE_URL=${VITE_ADMIN_BASE_URL}
COPY . .
RUN pnpm --filter client build && pnpm --filter server build && pnpm --filter server exec prisma generate

FROM node:${NODE_VERSION} AS backend
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3001
ENV SERVE_STATIC_CLIENT=false
ENV INCUDAL_APP_DIR=/app
ENV INCUDAL_INSTALL_DIR=/opt/incudal
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.14.2 --activate
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && mkdir -p /opt/incudal/plugins /opt/incudal/plugin-data /opt/incudal/plugin-logs /opt/incudal/plugin-staging \
    /opt/incudal/themes /opt/incudal/theme-data /opt/incudal/theme-staging \
    /opt/incudal/update-logs /opt/incudal/plugin-market /opt/incudal/theme-market
COPY --from=build /app/package.json /app/pnpm-lock.yaml /app/pnpm-workspace.yaml ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/server/package.json ./server/package.json
COPY --from=build /app/server/node_modules ./server/node_modules
COPY --from=build /app/server/dist ./server/dist
COPY --from=build /app/server/prisma ./server/prisma
COPY --from=build /app/server/prisma.config.ts ./server/prisma.config.ts
COPY --from=build /app/server/templates ./server/templates
COPY --from=build /app/server/certs ./server/certs
COPY deploy/docker/backend-entrypoint.sh /usr/local/bin/backend-entrypoint.sh
RUN chmod +x /usr/local/bin/backend-entrypoint.sh
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 CMD node -e "fetch('http://127.0.0.1:3001/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["backend-entrypoint.sh"]
CMD ["node", "server/dist/app.js"]

FROM nginx:${NGINX_VERSION} AS frontend
COPY --from=build /app/client/dist/user /usr/share/nginx/html/user
COPY --from=build /app/client/dist/admin /usr/share/nginx/html/admin
COPY deploy/docker/nginx.conf.template /etc/nginx/templates/default.conf.template
EXPOSE 80
