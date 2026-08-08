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
# --legacy: pnpm v10+ 默认要求 inject-workspace-packages，仓库未启用，用 legacy 模式
RUN pnpm deploy --legacy --filter=@walnut/server --prod /out

# ---------- runtime ----------
FROM node:24-bookworm-slim AS runtime

ENV NODE_ENV=production
WORKDIR /app

COPY --from=builder /out ./

# 日志目录（winston daily rotate），compose 可挂载
RUN mkdir -p /app/logs

EXPOSE 3000

# monorepo 合并后源码在 apps/api/src/，prod build（infra/nest/prod.json）输出到 dist/apps/api/src/main.js
CMD ["node", "dist/apps/api/src/main.js"]
