# ---------- builder ----------
FROM node:24-bookworm-slim AS builder

WORKDIR /app

# pnpm 固定版本（root package.json 的 packageManager 字段）
RUN corepack enable && corepack prepare pnpm@11.20.0 --activate

# 全量源码（monorepo context）
COPY . .

# workspace 依赖安装（--frozen-lockfile 保证与 CI 一致）
RUN pnpm install --frozen-lockfile

# workspace 共享包 CJS 构建（@walnut/server 依赖其 dist）
RUN pnpm --filter @walnut/contract build

# 后端构建
RUN pnpm --filter @walnut/server build

# 提取生产依赖到 /out（含 node_modules + package.json + workspace 包产物）
RUN pnpm deploy --filter=@walnut/server --prod /out

# ---------- runtime ----------
FROM node:24-bookworm-slim AS runtime

ENV NODE_ENV=production
WORKDIR /app

COPY --from=builder /out ./

# 日志目录（winston daily rotate），compose 可挂载
RUN mkdir -p /app/logs

EXPOSE 3000

CMD ["node", "dist/walnut/admin/com/app/main.js"]
