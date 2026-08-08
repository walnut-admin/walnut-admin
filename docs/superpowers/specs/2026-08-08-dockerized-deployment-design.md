# Walnut Admin 全容器化部署设计

日期：2026-08-08

## 背景与现状

- 单台国内云服务器（腾讯云，4 核 4G，Ubuntu 24.04），域名备案已完成，前端域名 + API 域名双域名，腾讯云免费证书（一年一换）。
- 已容器化：MongoDB 副本集（primary/secondary/arbiter，`apps/server/db/docker-compose.prod.yml`）+ Redis（`apps/server/docker/docker-compose.dev.yml`），bitnami 镜像，**均暴露公网端口**。
- 未容器化：前端（Vite 产物由宿主机 Nginx serve 静态文件）、后端（NestJS 由 PM2 运行）。
- Nginx 位于宿主机（`/etc/nginx/conf.d/`），含 brotli 模块（手动编译）、双域名 SSL、`/api/` 与 `/socket/` 反代、WebSocket upgrade。
- `.github/workflows/deploy.yml` 为 SCP + PM2 方案，含 TODO：monorepo 未适配，需重新设计。
- Docker Hub 国内不可访问，服务器拉镜像必须走国内云厂商仓库。

## 目标

1. 前端、后端也容器化，最终全栈（nginx + frontend + backend + mongodb×3 + redis）由单一 `docker-compose.yml` 编排，服务器上仅剩 Docker 一层。
2. GitHub Actions（公开仓库，免费）负责构建镜像 → 推送腾讯云 TCR（个人版免费）→ SSH 触发服务器滚动部署。
3. 保留 brotli 压缩（前端预压缩 `.br` 文件 + API 运行时压缩）。
4. 本阶段先接 production；stage 环境（火山引擎服务器）后置，不阻塞本期。
5. 顺带修复：数据库/Redis 不再暴露公网端口。

## 非目标

- 不引入 Kubernetes / 容器编排平台（单机 demo，Compose 足够）。
- 不迁移到 1Panel 等面板。
- 不改造证书签发方式（维持腾讯云免费证书，一年一换，手动替换 + reload）。
- 不引入蓝绿/金丝雀发布（镜像 tag 版本化 + 回滚即可）。

## 决策记录（已与用户确认）

| 决策点 | 结论 |
|--------|------|
| 部署方案 | 全容器化（Nginx 也容器化） |
| 镜像仓库 | 腾讯云 TCR 个人版（免费：10 命名空间、单地域 500 仓库、单镜像 100 版本；服务器在腾讯云，同地域内网拉取快） |
| CI 工具 | GitHub Actions（仓库公开，免费无限量） |
| 压缩 | 保留 brotli：自定义 nginx 镜像（`apk add nginx-mod-http-brotli`） |
| 环境 | 本阶段先接 production（现有腾讯云上海服务器）；compose 的 `.env` 机制天然支持多环境，stage 服务器（火山引擎，未购买）到位后拷 `deploy/` + 写 `.env` + 配 secrets 即可，代码零改动 |
| 进程管理 | 去掉 PM2，容器 `restart: always` |
| 前端 env 来源 | **方案 B：`.env.keys` 私钥存入 GitHub Secrets，CI 先 `pnpm setup-env` 解密 `env-encrypted/` → `env-local/`，前端构建与本地行为完全一致**。env 变更只需更新 `env-encrypted/`，CI 自动同步，无需逐项维护 secret |

## 目标架构

```
公网 80/443
    │
    ▼
┌───────────────────── docker bridge 网络（服务名互访）─────────────────────┐
│  nginx（入口，挂载 conf.d + certs，映射 80/443，自建镜像含 brotli）          │
│    ├── /         → frontend（内部 80，nginx:alpine，静态文件 + try_files）  │
│    ├── /api/     → backend（内部 3000，NestJS）                           │
│    └── /socket/  → backend（WebSocket upgrade）                          │
│  backend ── mongodb://prod-mongodb-primary:27017,...（服务名）            │
│  backend ── redis://prod-single-redis:6379（服务名）                      │
│  mongodb-primary / mongodb-secondary / mongodb-arbiter / redis           │
│    （无 ports 映射，公网不可达）                                            │
└──────────────────────────────────────────────────────────────────────────┘
```

- 容器间一律用服务名通信，无 IP 硬编码（容器 IP 重启会变）。
- 后端环境变量通过挂载的 `.env`（服务器上由 dotenvx 解密生成，密钥不进镜像）。

## 文件改动清单

```
新增：
  deploy/docker-compose.yml          # 全栈编排（.env 区分 stage/prod）
  deploy/.env.example                # 环境变量模板（域名、证书路径、镜像 tag 等）
  deploy/nginx/conf.d/frontend.conf  # 前端域名 443（静态 + /api/ + /socket/ 反代）
  deploy/nginx/conf.d/api.conf       # API 域名 443
  deploy/nginx/certs/                # 证书挂载目录（服务器上放置，不入库）
  deploy/nginx/Dockerfile            # nginx + brotli 自建镜像
  deploy/README.md                   # 服务器初始化/更新/回滚/证书更换操作手册
  apps/admin/Dockerfile              # 前端多阶段（monorepo context）
  apps/server/Dockerfile             # 后端多阶段（monorepo context）
  .dockerignore                      # 排除 node_modules/dist 等，保证构建缓存高效

修改：
  .github/workflows/deploy.yml       # 重写为 Docker 流水线
  apps/server/env/*（env-local 实际值） # 连接串 127.0.0.1 → 服务名

废弃：
  apps/server/db/docker-compose.prod.yml   # 并入根级编排
  apps/server/docker/docker-compose.dev.yml# 保留（本地开发用）或按需调整
```

## Dockerfile 设计

### 前端 `apps/admin/Dockerfile`（多阶段）

```dockerfile
# stage 1: build（node:24 + pnpm，monorepo context）
#   --build-arg ENVIRONMENT=prod/stage（仅传简单值，不传复杂字符串）
#   构建前 CI 已用 GitHub Secrets 生成真实 env 文件（apps/admin/env/.env.production）
#   仓库内为 {{your real api url}} 占位符；Vite 的 VITE_* 是构建期变量，构建时烤进产物
#   COPY env/.env.${ENVIRONMENT} → pnpm --filter @walnut/admin build
#   （产出 dist + .br/.gz 预压缩文件）
# stage 2: runtime（nginx:alpine）
#   COPY --from=build dist → /usr/share/nginx/html
#   挂载自定义 nginx.conf（try_files 回退、brotli_static、gzip）
```

**前端 env 注入流程（方案 B：CI 统一解密，与本地构建完全一致）**：

```
GitHub Secrets: ENV_KEYS（.env.keys 文件内容，含全部 env 的私钥）
      │
      ▼  CI 步骤（install 之后）
pnpm setup-env   ← dotenvx 用 ENV_KEYS 解密 apps/admin/env-encrypted/ → apps/admin/env-local/
      │
      ▼
pnpm --filter @walnut/admin build   ← Vite 读 env-local/.env.production（真实值）
      │                                 VITE_* 构建期烤进 JS 产物
      ▼
产物 → nginx:alpine 镜像 → 推 TCR

要点：
- 前端构建行为 = 本地构建行为（VITE_PROXY 等一切值原样使用，无特判、无留空技巧）
- VITE_PROXY 结构（[[1,"/api",url],[1,"/socket",url,path,ns]]）保持用户配置不变；
  代理模式（首元素 1）下产物仅含相对路径 /api，真实 URL 不烤进产物
- 后端镜像不需要 env（运行时挂载）；CI 里 setup-env 只为前端构建
- env 值变更：更新 env-encrypted/ 并提交 → CI 自动解密，无需维护第二个秘密副本
```

### 后端 `apps/server/Dockerfile`（多阶段）

```dockerfile
# stage 1: build（node:24 + pnpm，monorepo context）
#   pnpm install --frozen-lockfile
#   pnpm --filter @walnut/utils build && pnpm --filter @walnut/contract build
#     （@walnut/server 依赖其 CJS 构建产物，必须先构建）
#   pnpm --filter @walnut/server build
# stage 2: runtime（node:24-alpine）
#   COPY dist + package.json（生产依赖）
#   CMD node dist/main（Nest 产物入口按实际调整）
# 环境变量：运行时挂载 .env，不进镜像
```

### nginx `deploy/nginx/Dockerfile`（brotli 镜像）

```dockerfile
FROM nginx:alpine
# Alpine 官方仓库提供 nginx-mod-http-brotli 动态模块（含 filter + static 两个 .so）
# 注意：动态模块 ABI 必须与镜像内 nginx 主版本一致；
#       若 nginx:alpine 版本与 Alpine 仓库 nginx 版本不一致导致模块加载失败，
#       改用 FROM alpine + apk add nginx nginx-mod-http-brotli（同源安装天然匹配）。
RUN apk add --no-cache nginx-mod-http-brotli
RUN nginx -t   # 构建期验证模块加载，版本不匹配 → 构建失败（fail fast）
# conf 内 load_module /usr/lib/nginx/modules/ngx_http_brotli_*.so
```

## Compose 设计要点

- 单份 `docker-compose.yml`，`env_file`/`environment` 引用 `.env`（`.env.production` / `.env.stage`），两台服务器各自维护。
- 镜像 tag 走变量（如 `IMG_TAG`），回滚 = 改 tag 重 `up -d`。
- 后端健康检查（如 HTTP 探测），nginx `depends_on` 后端健康后启动，避免启动竞态。
- mongodb 副本集服务名/副本集名与现网保持一致，数据卷不变（`mongodb_master_data`、`redis_data`），升级不动数据。
- **所有数据库/Redis 服务移除 `ports` 映射**。

## Nginx 配置迁移要点

- `frontend.conf`：443 + 静态 `try_files` + `/api/` 反代到 `backend:3000` + `/socket/`（WebSocket upgrade 头）→ 代理目标从 `127.0.0.1:3000` 改为服务名 `backend`。
- `api.conf`：API 域名 443 → 反代 `backend`。
- brotli：`brotli on`（filter）+ `brotli_static on`（静态预压缩），`brotli_types` 沿用现网列表。
- gzip 保留（对不支持 brotli 的客户端兜底）。
- 证书路径挂载为 `/etc/nginx/certs`（宿主机 `deploy/nginx/certs/`）。

## CI 流水线（重写 deploy.yml）

```
触发：workflow_dispatch（本阶段仅 prod；stage 服务器到位后再放开选项）
步骤：
  1. checkout + pnpm 缓存 + pnpm install
  2. 写入 .env.keys（secrets: ENV_KEYS）→ pnpm setup-env 解密 → 前端构建用 env-local
  3. docker login 腾讯云 TCR（secrets: TCR_USERNAME=账号ID、TCR_PASSWORD=初始化密码）
  4. docker build 前端镜像 + 后端镜像 + nginx 镜像（tag = git SHA；--build-arg ENVIRONMENT=prod）
  5. docker push 三个镜像
  6. SSH 到 prod 服务器：cd deploy && docker compose pull && docker compose up -d
     （可选）docker image prune 清理旧镜像

新增 Secrets：ENV_KEYS（.env.keys 内容）、TCR_USERNAME、TCR_PASSWORD；
服务器 SSH 凭据沿用现有 PROD_* 系列。

stage 接入（后置）：火山引擎服务器到位后，补一套 STAGE_* secrets + 服务器上写 .env + 域名证书，CI 加回 stage 选项，代码零改动。
```

## 运维流程

- **证书更新**（一年一次）：替换 `deploy/nginx/certs/` 文件 → `docker exec <nginx容器> nginx -s reload`。
- **回滚**：改 `.env` 中 `IMG_TAG` 为上一版本 → `docker compose up -d`。
- **服务器迁移**：拷 `deploy/` 目录 + `.env` → `docker compose up -d`。
- **日志**：`docker compose logs -f backend`；持久化日志目录挂载（按需）。

## 风险与待验证

1. **brotli 模块版本匹配**（风险中）：构建期 `nginx -t` 兜底；不匹配时降级方案为 `FROM alpine` 同源安装。
2. **monorepo Docker 构建**（风险中）：build context 为仓库根，`.dockerignore` 需精确，否则缓存失效/构建变慢；后端依赖链（utils/contract 先构建）顺序必须正确。
3. **TCR 个人版配额**：命名空间/仓库数充足（10/500）；镜像版本 100 上限，需定期清理旧 tag（CI 里加 prune）。
4. **后端 `.env` 挂载**：dotenvx 解密流程在服务器上保持（`pnpm setup-env`），容器挂载解密后的 env-local 文件。**镜像不含密钥**（CI 只解密用于前端构建；后端密钥在服务器解密后挂载进容器）。**关键密钥（OPAQUE、MFA、RT、DEVICE_ID、USER_ID 加密 key）严禁变更**，迁移时原样带过去。
5. **`.env.keys` 进 GitHub Secrets（方案 B 代价）**：CI 获得解密全站 env 的能力。风险控制：workflow 仅 `workflow_dispatch`/`push` 触发（不涉及 fork PR secrets）；CI 中 `echo`/打印该值会被 Actions 自动打码；一旦泄露，需重新生成 `env-encrypted/` 全部文件并更新 secret。收益：env 变更零额外维护。
5. **前端 env 注入**：方案 B 下 CI 跑 `pnpm setup-env` 解密（与本地一致），无 build-arg 特判；注意 CI 里 setup-env 需要 pnpm + dotenvx 可用（`pnpm install` 后即可），且 `.env.keys` 写入位置须与仓库内引用路径一致（根目录）。

## 测试与验收

1. 本地：`docker compose -f deploy/docker-compose.yml up -d`（或先 build 三个镜像）→ 全栈启动，前端域名/API 域名/socket 均可访问，WebAuthn/MFA 等关键流程可用（依赖后端连通性验证）。
2. CI：Actions 构建推送成功后，服务器 `docker compose pull && up -d` 部署新版本，`docker compose ps` 全部 healthy。
3. 回滚演练：改 tag 部署上一版本，验证可用。
4. 安全验收：`ss -tlnp` 确认 27017/6379 等不再对外监听；HTTPS 证书有效；`/api/`、`/socket/` 反代正常。
5. 性能抽查：brotli 响应头 `content-encoding: br` 生效（静态 .br 与 JSON filter 两路）。
