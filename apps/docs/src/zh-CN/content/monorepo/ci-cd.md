# CI/CD 与容器构建

> 本文描述当前的 CI/CD 设计与容器构建方式：**commit 只跑质量门禁、tag 才构建镜像、部署不再构建**。
> 运维操作（服务器初始化、回滚、证书更换）见仓库 `deploy/README.md`。
> 历史设计与实施记录见 [归档文档](/content/archive/2026-09-21-ci-cd-pipeline-plan)。

## 触发矩阵

| Workflow | 触发 | 内容 | 是否会构建容器 |
|----------|------|------|----------------|
| `ci.yml` | push `main`、PR | boundaries → affected lint/types:check/test → affected 自检 → syncpack → server 构建（+ 有 secret 时 admin 构建） | ❌ |
| `workflow-lint.yml` | `.github/**` 变更 | actionlint 校验所有 workflow 与本地 composite action | ❌ |
| `release.yml` | tag `v*.*.*` | verify ∥ images → GitHub Release → 自动部署 | ✅ 仅此一处 |
| `deploy.yml` | `workflow_call`（被 release 复用）/ `workflow_dispatch`（回滚重发） | 纯部署：校验镜像存在 → 生成 env → scp → `compose pull && up -d --wait` → 健康检查 | ❌ |

发布流仍是 `pnpm release`（changeset 版本号 → changelog → commit → tag `vX.Y.Z` → push 分支与 tag，见 [发布 & 发版指南](./release.md)）。
**tag 因此成为"只构建一次"的锚点**：失败后在该 run 上点 *Re-run all jobs* 即可，缓存命中后通常个位数分钟。

### 为什么拆成两个 workflow 文件

非法 workflow 文件**自己不会运行**：GitHub 判定 `Invalid workflow file` 后启动即失败、0 个 job，在 Actions 列表里只留一个看起来"跑失败了"的红叉。

本仓在 2026-08-13 → 09-21 真实发生过这件事：`ci.yml` 的 step 级 `if` 里写了 `secrets` 上下文（该位置不允许），质量门禁**五周没跑过一次**，而没有人察觉。所以校验必须由**另一个文件**承担 —— `workflow-lint.yml` 坏了，别的工作流还能报出来。

## 容器构建：薄镜像

```
runner（pnpm store 命中，install ≈30s）
  ├─ turbo run build --filter=@walnut/server...      → apps/server/dist
  ├─ turbo run build --filter=@walnut/admin          → apps/admin/dist（含 .br/.gz 预压缩）
  ├─ pnpm deploy --legacy --filter=@walnut/server --prod <stage>/server
  ├─ stage frontend：dist 拷贝 + frontend-server.conf
  └─ docker buildx bake
        ├─ nginx     （docker build 先推送，约 20s；含 brotli 模块）
        ├─ backend   （context=<stage>/server，只 COPY，scope=backend）
        └─ frontend  （context=<stage>/frontend，FROM nginx:${TAG}，scope=frontend）
```

三个关键点：

1. **镜像内不再 install / 构建**。历史实现把全仓 5800+ 依赖的 `pnpm install`、SWC 构建、`pnpm deploy` 都塞进镜像：单次上线实测 **85 分 07 秒**，其中 backend 镜像构建 **77 分 53 秒**（同一份 Dockerfile 在另一 run 只要 15 分 49 秒）。
2. **每个镜像独立的 buildx 缓存 scope**（见 `docker-bake.hcl`）。三次 build 若共用默认 `scope=buildkit`，会互相覆盖缓存（Docker 官方文档："each build will overwrite the cache of the previous"）→ 第一个构建的 backend 永远是冷缓存，这正是 15 分钟 ~ 78 分钟巨大抖动的原因。
3. **backend 与 frontend 在同一个 bake 里并行构建**；nginx 因为被 frontend 的 `FROM` 依赖，单独用 `docker build` 先推送，顺序确定、无隐式依赖。

### 度量基线（本地实测，pnpm 12.5.1）

| 项 | 数值 |
|----|------|
| `pnpm install`（store 命中） | 4–8s 本地 / ≈30s CI |
| `pnpm deploy --legacy --prod` | 19–31s（产物 **268.6 MB / 41561 文件**，其中 node_modules 255 MB） |
| admin 生产构建（Vite + brotli/gzip + Sentry） | **178.9s**，dist **12.68 MB**（489 `.br` + 489 `.gz`） |
| `turbo run types:check`（无 packages 构建产物，模拟全新 clone） | 12/12 通过，41.4s |

## 两条必须记住的硬约束

### 1. workflow 里禁止把 `secrets` 写进 `if`

`jobs.<id>.if` / `steps.*.if` 只暴露 `github / needs / strategy / matrix / job / runner / env / vars / steps / inputs`。需要按 secret 是否存在决定是否执行时，先绑到 job 级 `env`，再用 `env.X != ''` 判断：

```yaml
jobs:
  build:
    env:
      DOTENVX_KEYS: ${{ secrets.ENV_KEYS }}   # 先绑定
    steps:
      - name: Decrypt environment files
        if: env.DOTENVX_KEYS != ''            # 再用 env 判断
        uses: ./.github/actions/decrypt-env
        with:
          keys: ${{ env.DOTENVX_KEYS }}
```

解密逻辑抽在 `.github/actions/decrypt-env`（ci / release / deploy 三处共用），密钥用完立即 `rm .env.keys`。

### 2. `pnpm deploy --prod` 必须是 job 里最后一个 pnpm 命令

它会把工作区 `node_modules/.modules.yaml` 标成 `devDependencies: false`，此后**任何** pnpm 命令都会自动按 prod 重装 —— `vite`、`cross-env` 等开发依赖当场被删掉（本地实测：deploy 之后跑 `pnpm exec` 立即触发 prune）。这与 staging 目录位置无关。

配套地，staging 落在**工作区之外**（`IMAGE_STAGE=../walnut-image-staging`），避免 268 MB / 4 万文件污染工作树。

## 安全：镜像里不再有明文密钥

`pnpm deploy --prod` 会把 `apps/server/env-local/`（dotenvx 解密出的 `.env.production`，含数据库/Redis 密码与 OPAQUE/MFA/RT 等加密 key）**一起拷进产物**；旧 Dockerfile 直接 `COPY --from=builder /out ./` → 这些明文密钥被烤进了生产镜像。

现在有两层防御：

- `release.yml` 的 staging 步骤：`rm -rf <stage>/server/{env-local,env-encrypted}`
- `apps/server/Dockerfile`：`RUN rm -rf /app/env-local /app/env-encrypted …` 兜底

compose 以 bind mount 注入 `./env/.env.production`，镜像里不需要也不允许存在 env 文件。

## 本地验证 CI 改动

```bash
pnpm lint:workflows    # actionlint（未安装则跳过并提示；CI 中强制执行）
pnpm images:print      # 只解析 docker-bake.hcl，不构建
pnpm images:build      # 本地构建 backend + frontend（先按 deploy/README.md 准备 staging）
```

> ⚠️ **本地跑 actionlint 时务必装 shellcheck**。actionlint 只有在 PATH 上存在 `shellcheck` 时才做 SC* 检查：本机没装 → 本地 exit 0，而 ubuntu-latest runner 预装 → 同一个文件在 CI 上退出码 1（本仓首跑就是这么红了一次：`docker login $REGISTRY` 少引号，SC2086）。

## 相关

- [发布 & 发版指南](./release.md) — tag 是怎么打出来的
- [环境变量加密管理](./env-management.md) — `env-encrypted/` 与 `ENV_KEYS` secret
- [Turbo](./turbo.md) — affected 的基准为什么必须显式指定
- [架构待办事项](./architecture-todo.md) — CI/CD 相关的遗留项
- 归档：[CI/CD 重构实施记录](/content/archive/2026-09-21-ci-cd-pipeline-plan)、[全容器化部署设计（2026-08-08）](/content/archive/2026-08-08-dockerized-deployment-design)
