# =====================================================
# Incudal 多阶段构建 Dockerfile
# =====================================================

# Stage 1: 依赖安装
FROM node:22-alpine AS deps
RUN corepack enable && corepack prepare pnpm@9 --activate
WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY client/package.json ./client/
COPY server/package.json ./server/

RUN pnpm install --frozen-lockfile --ignore-scripts

# esbuild 依赖安装脚本不能被跳过，否则 Vite 在构建阶段无法启动二进制
RUN pnpm rebuild esbuild

# Stage 2: 构建前端
FROM node:22-alpine AS builder-client
RUN corepack enable && corepack prepare pnpm@9 --activate
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/client/node_modules ./client/node_modules
COPY client ./client
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

RUN pnpm --filter client build

# Stage 3: 构建后端
FROM node:22-alpine AS builder-server
RUN corepack enable && corepack prepare pnpm@9 --activate
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/server/node_modules ./server/node_modules
COPY server ./server
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

# 生成 Prisma Client 并构建
WORKDIR /app/server
RUN DATABASE_URL="postgresql://user:pass@localhost:5432/db" npx prisma generate
WORKDIR /app
RUN pnpm --filter server build

# Stage 4: 生产镜像
FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production

# 创建非 root 用户
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 incudal

# 复制依赖 (包含生成的 Prisma Client)
COPY --from=builder-server /app/node_modules ./node_modules
COPY --from=builder-server /app/server/node_modules ./server/node_modules

# 复制构建产物
COPY --from=builder-server /app/server/dist ./server/dist
COPY --from=builder-client /app/client/dist ./client/dist

# 复制必要配置文件
COPY server/package.json ./server/
COPY server/prisma.config.ts ./server/
COPY server/prisma ./server/prisma
COPY server/templates ./server/templates
COPY server/scripts ./server/scripts
COPY server/src ./server/src
COPY package.json pnpm-workspace.yaml ./

# 复制启动脚本
COPY server/docker-entrypoint.sh ./server/
RUN chmod +x ./server/docker-entrypoint.sh

# 创建证书目录
RUN mkdir -p server/certs && chown -R incudal:nodejs server/certs

USER incudal

EXPOSE 3000

ENTRYPOINT ["./server/docker-entrypoint.sh"]
