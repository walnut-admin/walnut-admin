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
# - .data：Cap.js 的运行态 token 存储（apps/server/.data/，gitignored）—— pnpm deploy 会把它
#   拷进 staging 产物，镜像里没有意义（进程启动时自建）。
# - .tmp / logs / dist-stage：本地构建路径的兜底（CI 干净 checkout 不带这些）。
# - openapi.json / apps/api/test：tracked 文件，CI staging 也必带，rm 是必要清理。
# - .tmp 可能含 app_key.jsonl（ACTIVE AES key）与真实数据 dump，
#   dist-stage / test 是另一套构建与测试面，都不允许进镜像。
RUN rm -rf /app/env-local /app/env-encrypted /app/.turbo /app/.vscode /app/docs /app/playwright /app/docker /app/.data \
    /app/.tmp /app/logs /app/dist-stage /app/openapi.json /app/apps/api/test \
    && mkdir -p /app/logs

EXPOSE 3000

# 只有**一个**入口：api。worker 不需要第二个 stage / target，镜像保持单层单 CMD ——
# 依据（batch-3 R1 实测，reports/batch-3/r1-verification.md §2.1）：同一次 `nest build api` 已经把
# dist/apps/worker/src/main.js 一起产出了（infra/nest/prod.json:52 的 filenames 含 apps/worker/src；
# SWC 的落点 = 相对 apps/server 的路径镜像，与 tsconfig 的 include 无关），
# api 用到的 i18n / views 资产也由 api 与 worker 两个 project 的 assets 拷进**同一份** dist。
# 所以 compose 里的 worker service 只是覆盖 command（deploy/docker-compose.yml），与 api 共用本镜像；
# worker 没有 HTTP 监听，EXPOSE 3000 对它无意义但不影响。
#
# prod 构建输出入口：dist/apps/api/src/main.js（源码在 apps/api/src/，见 infra/nest/prod.json）
# worker 入口：dist/apps/worker/src/main.js（compose 的 worker service 用 command 覆盖本行）
CMD ["node", "dist/apps/api/src/main.js"]
