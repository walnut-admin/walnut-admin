# ---------- builder ----------
FROM node:24-bookworm-slim AS builder

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@11.20.0 --activate

# 构建内存：CI runner 约 7GB，本地 8G 配置直接沿用会 OOM
ENV NODE_OPTIONS=--max-old-space-size=4096

# 先拷贝依赖清单（仅 15 个文件），install 层只在依赖变更时失效，
# 配合 CI 的 buildx gha 缓存实现跨运行命中
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/admin/package.json apps/admin/package.json
COPY apps/server/package.json apps/server/package.json
COPY apps/docs/package.json apps/docs/package.json
COPY packages/platform-any/contract/package.json packages/platform-any/contract/package.json
COPY packages/platform-any/types/package.json packages/platform-any/types/package.json
COPY packages/platform-any/utils/package.json packages/platform-any/utils/package.json
COPY packages/platform-web/client/package.json packages/platform-web/client/package.json
COPY packages/platform-web/http/package.json packages/platform-web/http/package.json
COPY packages/platform-web/ui/package.json packages/platform-web/ui/package.json
COPY packages/tooling/eslint-config/package.json packages/tooling/eslint-config/package.json
COPY packages/tooling/commitlint-config/package.json packages/tooling/commitlint-config/package.json
COPY packages/tooling/release/package.json packages/tooling/release/package.json

RUN pnpm install --frozen-lockfile

# env-local 由 CI 的 setup-env 解密生成，随 COPY . . 进入上下文
# （.env.keys 已被 .dockerignore 排除，密钥不进入镜像；runtime 只取 dist）
COPY . .

RUN pnpm --filter @walnut/admin build

# ---------- runtime ----------
# 使用 Task 4 构建的 brotli 镜像（含 brotli_static/filter 模块）
FROM walnut-admin/nginx-brotli:latest AS runtime

COPY --from=builder /app/apps/admin/dist /usr/share/nginx/html
COPY deploy/nginx/frontend-server.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
