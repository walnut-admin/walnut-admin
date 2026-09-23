# CI/CD 与容器构建重构设计

日期：2026-09-21
关联：[2026-08-08 全容器化部署设计](./2026-08-08-dockerized-deployment-design.md)（镜像仓库 / compose / 证书部分继续有效，CI 构建部分由本文取代）

## 1. 背景：三个被误解或未被发现的事实

用户反馈："每次 commit 都会触发 CI、每次都构建容器、大概跑 1 小时。" 实测结论与直觉不同：

| 反馈 | 实测 |
|------|------|
| 每次 commit 构建容器 | **从未发生**。仓库 16 次 run = 14 次 Deploy（全部 `workflow_dispatch` 手动触发）+ 2 次 CI。容器构建只在手动部署时发生 |
| 每次 commit 都会触发 CI | 触发是真的，但 **CI 从未真正运行**：两次 CI run 都是 0 个 job 的 startup_failure |
| CI 跑 1 小时 | 1 小时发生在**手动部署**流程：deploy run #14 总耗时 85 分 07 秒，其中 backend 镜像构建 77 分 53 秒 |

### 1.1 证据：CI 文件非法（R1）

```
Invalid workflow file:
(Line: 77, Col: 13): Unrecognized named-value: 'secrets'.
  Located at position 1 within expression: secrets.DOTENVX_KEYS_FILE != '',
(Line: 85, Col: 13): Unrecognized named-value: 'secrets'.
```

`apps` 侧的 step 级 `if` 里用了 `secrets` 上下文。GitHub 只在该位置暴露
`github / needs / strategy / matrix / job / runner / env / vars / steps / inputs`，
非法表达式让**整个 workflow 文件**被拒绝：启动即失败、0 个 job。
Actions API `runs/31714441192/jobs` → `total_count: 0`，`check-runs` 也是 0 条。

**五周静默失效**（2026-08-13 → 09-21）：质量门禁（boundaries / affected lint / types:check / test / syncpack）
一道都没跑过，而界面上只显示一个"失败的 CI"，被当成普通的构建失败忽略。

### 1.2 证据：部署耗时分布（deploy run #14，2026-08-09）

| 步骤 | 耗时 |
|------|------|
| Set up job + actions 预构建 | 8s |
| Checkout / pnpm / Node | 7s |
| Install dependencies | 30s |
| Prepare env（解密） | 10s |
| Login TCR | 2s |
| **Build & push backend** | **77m53s** |
| Build & push nginx | 19s |
| Build & push frontend | 5m23s |
| Generate env + scp | 19s |
| Deploy on server | 4s |
| **合计** | **85m07s** |

run #8 的同一份 Dockerfile：backend 构建 **15 分 49 秒** —— 相差 5 倍，说明瓶颈是缓存/网络而非构建本身。

## 2. 根因

| # | 根因 | 依据 |
|---|------|------|
| R1 | workflow 非法 → CI 从未执行 | §1.1 |
| R2 | **buildx GHA 缓存 scope 冲突**：三次 build 都写 `cache-to: type=gha` 而没写 `scope`，scope 默认 `buildkit` → 多个镜像互相覆盖缓存（Docker 官方文档原文："each build will overwrite the cache of the previous, leaving only the final cache"）。backend 是第一个构建、frontend 是最后一个 → backend 每次冷启动，frontend 每次命中 | `deploy.yml` 旧内容；[Docker 文档](https://docs.docker.com/build/cache/backends/gha/) |
| R3 | 重活放进镜像：镜像内 `pnpm install` 全仓 5800+ 依赖 + `nest build` + `pnpm deploy --prod`。runner 上现成的 pnpm store 缓存（30s 装完）完全用不上 | 旧 `apps/server/Dockerfile`、`apps/admin/Dockerfile` |
| R4 | 串行 + 隐式耦合：backend → nginx → frontend 依次构建；frontend 的 `FROM walnut-admin/nginx-brotli:latest` 依赖"先在本机构建 nginx 镜像" | 旧 `deploy.yml` 步骤顺序 |
| R5 | 跨境推送：runner 在美国，镜像仓库在腾讯云上海。体积与耗时正相关（nginx ~19s / frontend ~5m / backend ~78m） | §1.2 |
| R6 | 构建与部署耦合：同一个 job、同一次手动 dispatch；回滚也要重建 | 旧 `deploy.yml` |

## 3. 设计

### 3.1 触发矩阵：commit 永不构建容器

| Workflow | 触发 | 内容 | 预计 |
|----------|------|------|------|
| `ci.yml` | `push: main`、`pull_request` | boundaries → affected lint/types/test → affected 自检 → syncpack → server 构建（+ 有 secret 时 admin 构建）。无 Docker | 5–8 min |
| `workflow-lint.yml` | `.github/**` 变更 | actionlint 校验所有 workflow + 本地 composite action | < 1 min |
| `release.yml` | tag `v*.*.*` | verify（全量门禁，与 images 并行）→ 构建推送三镜像 → GitHub Release → 自动部署 | 10–20 min |
| `deploy.yml` | `workflow_call`（被 release 复用）/ `workflow_dispatch`（回滚） | 纯部署：校验镜像存在 → 生成 env → scp → compose pull/up --wait → 健康检查 | 1–3 min |

发布流不变：`pnpm release` → changeset version → commit → `git tag vX.Y.Z` → push（见 `release.md`）。
tag 因此天然是"构建一次"的锚点。失败重发用 Actions 的 "Re-run all jobs"。

### 3.2 薄镜像：构建在 runner 上，镜像只 COPY

```
runner（pnpm store 命中，install ≈30s）
  ├─ turbo run build --filter=@walnut/server...        → apps/server/dist
  ├─ turbo run build --filter=@walnut/admin            → apps/admin/dist（含 .br/.gz）
  ├─ pnpm deploy --legacy --filter=@walnut/server --prod <stage>/server   （≈30s）
  ├─ stage frontend：dist 拷贝 + frontend-server.conf  → <stage>/frontend
  └─ docker buildx bake
        ├─ nginx     （docker build，先推送，≈20s）
        ├─ backend   （context=<stage>/server，只 COPY，scope=backend）
        └─ frontend  （context=<stage>/frontend，FROM nginx:${TAG}，scope=frontend）
```

- 每个 target 独立 GHA 缓存 scope（修 R2）。
- backend/frontend 在同一个 bake 里并行（修 R4）。
- staging 放在工作区之外（`IMAGE_STAGE=../walnut-image-staging`），不污染工作树。
- 镜像内不再有任何 `pnpm install`（修 R3）。

### 3.3 两个必须写进代码注释的约束

1. **workflow 里禁止 `secrets` 出现在 `if`**：需要按 secret 判断时，先绑到 job 级 `env`，再用 `env.X != ''`。
   本项目用 `.github/actions/decrypt-env` composite action 复用同一段解密逻辑，密钥用完即删。
2. **`pnpm deploy --prod` 必须是 job 里最后一个 pnpm 命令**：它会把工作区
   `node_modules/.modules.yaml` 的 `devDependencies` 标成 `false`，此后任何 pnpm 命令都会
   自动按 prod 重装 —— `vite`、`cross-env` 等开发依赖当场被删除（本地实测复现：deploy 之后
   跑 `pnpm exec` 立即触发 prune，`vite: False`）。与 staging 目录位置无关。

### 3.4 顺带修掉的安全问题：镜像里曾包含明文密钥

`pnpm deploy --prod` 会把 `apps/server/env-local/`（dotenvx 解密出的 `.env.production`，
含 `DATABASE_PASS`、`APP_REDIS_PASS`、OPAQUE/MFA/RT/DEVICE_ID/USER_ID 加密 key）一起拷进产物；
旧 Dockerfile 直接 `COPY --from=builder /out ./` → **这些明文密钥被烤进了生产镜像**。

新流程两层防御：
- release.yml 的 staging 步骤 `rm -rf <stage>/server/{env-local,env-encrypted}`
- backend Dockerfile 里 `RUN rm -rf /app/env-local /app/env-encrypted …` 兜底

### 3.5 部署证据链

旧的 "Deploy on server" 4 秒完成、无法自证真的换了镜像。新脚本输出：
部署前/后 `docker compose ps` 的 Service→Image 映射、`docker inspect` 的实际镜像名、
`docker compose up -d --wait --wait-timeout 180`（compose ≥2.17 时等待 healthcheck）、
以及既有的 `curl --resolve` 健康检查。

## 4. 度量基线（本地实测，pnpm 12.5.1 / Windows）

| 项 | 数值 | 说明 |
|----|------|------|
| `pnpm install`（store 命中） | 4.3–7.5s | CI 上约 30s（历史步骤数据） |
| `turbo run build --filter=@walnut/contract` | 2.9s | |
| `nest build api`（SWC，711 文件） | ~1s 编译 | |
| `pnpm deploy --legacy --prod` | 18.8s / 31.4s（一次 2m0.5s，Windows 文件系统抖动） | CI/Linux 预期更快 |
| deploy 产物体积 | **268.6 MB / 41561 文件** | node_modules 255MB（其中 tencentcloud-sdk-nodejs 35.7MB、mathjs 9MB）、dist 6.6MB、apps 6.4MB |
| 产物纯净度 | playwright / eslint / @swc/core 均不存在 | `--prod` 生效 |
| Vite 生产构建（`pnpm build:admin`） | **178.9s**（vite 本体 2m22s，7 个 turbo 任务） | 产物 **12.68 MB / 1470 文件**，含 489 `.br` + 489 `.gz` |
| `turbo run types:check --force`（无 packages 构建产物，模拟全新 clone） | 41.4s，12/12 通过 | 证明 CI 的 verify 不需要先 build |
| actionlint 校验（4 个 workflow + composite action） | exit 0 | 负例（旧 `if: secrets.X`）exit 1：`context "secrets" is not allowed here` |

## 5. 风险与回退

| 风险 | 缓解 |
|------|------|
| 薄镜像产物契约（`pnpm deploy` 输出路径/入口） | 已在本地验证：`<stage>/server/dist/apps/api/src/main.js` 存在、prod 依赖完整；CI 首次运行需确认容器能起 |
| `docker/bake-action` 输入名不匹配 | 输错只会被 GitHub 警告并忽略（回落到默认行为），不会让构建失败 |
| bake 变量/上下文路径 | 只使用文档明确支持的字段（`context`/`dockerfile`/`tags`/`args`/`cache-from`/`cache-to`/`group`/`variable`），未用 `dependsOn`、`contexts` 等需额外验证的特性 |
| 跨境推送仍是主要成本 | release.yml 输出 staging 体积与镜像 digest；若总时长仍 > 20 min 且推送占大头，再评估国内 self-hosted runner（需额外支出，另行确认） |
| TCR 个人版 100 版本配额 | 每个发布 tag 一套镜像；旧 tag 由 TCR 控制台或后续清理步骤处理 |

## 6. 明确不做

- 不引入 Kubernetes / 第三方托管 runner（Depot / Blacksmith 均为美国节点，不解决跨境推送）
- 不接 Turbo Remote Cache（`architecture-todo.md` P1-4 已决策不接入）
- 不改数据层（MongoDB 副本集 / Redis）与证书流程
