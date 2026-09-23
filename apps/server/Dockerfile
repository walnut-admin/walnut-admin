# ---------- runtime（薄镜像）----------
# 所有重活都在 CI runner 上完成，本文件只做 COPY：
#   pnpm install → SWC 构建（nest build api -c infra/nest/prod.json）
#   → pnpm deploy --legacy --filter=@walnut/server --prod build/image/server
# 产物 build/image/server 就是本镜像的构建上下文（见 docker-bake.hcl）。
#
# 为什么不再在镜像里 install/build：历史上镜像内要冷装全仓 5800+ 依赖再构建，
# 单次部署的 backend 构建耗时 77m53s（deploy run #14；整条流水线 85 分钟里它占 78 分钟）。
# runner 侧 pnpm store 有缓存，同样的 install 只要 ~30s。
#
# 本地复现（见 deploy/README.md「本地构建镜像」）：
#   pnpm exec turbo run build --filter=@walnut/server...
#   pnpm deploy --legacy --filter=@walnut/server --prod build/image/server
#   REGISTRY=... NS=... TAG=local pnpm images:build
FROM node:24-bookworm-slim

ENV NODE_ENV=production
WORKDIR /app

# 上下文内即 pnpm deploy --prod 产物：package.json + dist/ + node_modules/（仅生产依赖）
COPY . .

# 兜底清理（staging 步骤已删过一遍，这里保证镜像内绝不出现）：
# - env-local：dotenvx 解密出的明文密钥（数据库/Redis 密码、OPAQUE/MFA/RT 等加密 key）。
#   pnpm deploy 会把它一起拷进产物 —— 镜像里绝不允许有，compose 以 bind mount
#   注入 ./env/.env.production（见 deploy/docker-compose.yml）。
# - env-encrypted / .turbo / .vscode / docs / playwright / docker：构建期内容，运行不需要。
RUN rm -rf /app/env-local /app/env-encrypted /app/.turbo /app/.vscode /app/docs /app/playwright /app/docker \
    && mkdir -p /app/logs

EXPOSE 3000

# prod 构建输出入口：dist/apps/api/src/main.js（源码在 apps/api/src/，见 infra/nest/prod.json）
CMD ["node", "dist/apps/api/src/main.js"]
