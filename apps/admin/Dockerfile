# ---------- builder ----------
FROM node:24-bookworm-slim AS builder

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@11.20.0 --activate

# 构建内存：CI runner 约 7GB，本地 8G 配置直接沿用会 OOM
ENV NODE_OPTIONS=--max-old-space-size=4096

COPY . .

# env-local 在 .dockerignore 中排除，单独显式 COPY（构建输入）
COPY apps/admin/env-local/.env.production apps/admin/env-local/.env.production

RUN pnpm install --frozen-lockfile

RUN pnpm --filter @walnut/admin build

# ---------- runtime ----------
# 使用 Task 4 构建的 brotli 镜像（含 brotli_static/filter 模块）
FROM walnut-admin/nginx-brotli:latest AS runtime

COPY --from=builder /app/apps/admin/dist /usr/share/nginx/html
COPY deploy/nginx/frontend-server.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
