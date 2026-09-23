# CI/CD 与容器构建重构实施计划 + 执行记录

日期：2026-09-21
设计：[2026-09-21 CI/CD 与容器构建重构设计](../specs/2026-09-21-ci-cd-pipeline-design.md)

## 1. 目标与验收

| 场景 | 改造前 | 目标 | 验收方式 |
|------|--------|------|----------|
| push / PR | CI 从未运行（0 job startup_failure） | 质量门禁真正执行，≤8 min，无 Docker | Actions 里 CI run 有 ≥1 个 job、红/绿是真实检查结果 |
| tag 发布 | 手动 dispatch，85 min | 自动：门禁 → 镜像 → Release → 部署，≤20 min | run summary 里各步骤耗时 + 镜像 digest |
| 日常部署/回滚 | 需完整重建 | `workflow_dispatch` 指定 tag，≤3 min | 部署 job 耗时 + `docker compose ps` 证据 |
| 密钥泄漏 | 明文 env-local 被烤进 backend 镜像 | 镜像内不存在 env-local | `docker run --rm --entrypoint ls <img> /app/env-local` 应报不存在 |
| 缓存抖动 | backend 构建 15m49s ~ 77m53s | scope 隔离后稳定命中 | buildx 日志出现 `importing cache manifest … scope=backend` |

## 2. 改动清单

### 新增

| 文件 | 作用 |
|------|------|
| `.github/workflows/workflow-lint.yml` | actionlint 校验所有 workflow + 本地 action（独立文件，防止"坏文件自己不会运行"） |
| `.github/actions/decrypt-env/action.yml` | 复用解密逻辑（ci / release / deploy 三处），密钥用完即删 |
| `.github/workflows/release.yml`（重写） | tag 发布流水线：verify ∥ images → Release → deploy |
| `docker-bake.hcl` | 三镜像定义 + 独立 cache scope + staging 上下文变量 |
| `scripts/lint-workflows.ts` | `pnpm lint:workflows`（actionlint 缺失时跳过），已接入 pre-push |
| `deploy/nginx/.dockerignore` | 不让证书私钥进入构建上下文 |
| `docs/superpowers/specs/2026-09-21-ci-cd-pipeline-design.md` | 设计文档（含证据与度量基线） |
| `docs/superpowers/plans/2026-09-21-ci-cd-pipeline.md` | 本文件 |

### 修改

| 文件 | 改动 |
|------|------|
| `.github/workflows/ci.yml` | ① 删掉 `steps.if` 里的 `secrets`（非法表达式）② secret 绑到 job 级 env，用 `env.X != ''` 判断 ③ 显式 `TURBO_SCM_BASE/HEAD` ④ 新增 affected 空集自检 ⑤ 顶部写明禁止事项 |
| `.github/workflows/deploy.yml` | 改为 reusable（`workflow_call`）+ `workflow_dispatch`；删除全部构建步骤；新增"镜像存在性校验"；部署脚本加 `--wait`、前后 `ps`/`inspect` 证据链、Summary |
| `apps/server/Dockerfile` | 多阶段 → 薄运行时（只 COPY staging 产物；`rm -rf env-local` 等兜底） |
| `apps/admin/Dockerfile` | 去掉 `FROM walnut-admin/nginx-brotli:latest` 本地 tag 耦合，改 `ARG NGINX_BASE`；只 COPY `html/` + conf |
| `package.json` | 新增 `lint:workflows` / `images:build` / `images:push` / `images:print`；pre-push 加 `pnpm lint:workflows` |
| `.gitignore` | 忽略 `build/image/`（本地镜像 staging） |

## 3. 执行顺序（已按此实施）

1. 修 ci.yml 的非法表达式 + affected 基准（止血：CI 必须真的跑起来）
2. 加 workflow-lint.yml（兜住同类事故）
3. 拆流水线：release.yml（tag → 构建 → 发布 → 部署）、deploy.yml（纯部署、可复用）
4. 容器优化：docker-bake.hcl（scope 隔离 + 并行）→ 薄 Dockerfile → staging + secrets 剔除
5. 本地验证 + 度量
6. 文档同步（spec/plan、architecture-todo、turbo.md、deploy/README、AGENTS/CLAUDE）

## 4. 本地验证结果（pnpm 12.5.1 / Windows）

| 验证项 | 命令 | 结果 |
|--------|------|------|
| workflow / action 语法与表达式 | `actionlint -color`（v1.7.12） | **exit 0**，四个 workflow + composite action 全通过 |
| **门禁有效性（负例）** | 把旧写法 `if: ${{ secrets.X != '' }}` 单独喂给 actionlint | **exit 1**：`context "secrets" is not allowed here. available contexts are "env", "github", …` —— 证明新闸门能抓住这次事故 |
| 本地守卫脚本 | `pnpm lint:workflows`（装了 actionlint / 未装两种情形） | 装了 → 透传 actionlint 退出码（0）；未装 → 明确提示并跳过（0），不阻塞 push |
| 新增/改动文件的 lint | `eslint scripts/lint-workflows.ts package.json` | 干净（首轮报 2 处 `node/prefer-global/process` + 1 处 import 排序，均已修） |
| 依赖一致性 | `pnpm syncpack:lint` | `✓ No issues found` |
| package.json 有效性 | `node -e "JSON.parse(...)"` | OK |
| **全新 clone 的 types:check** | 临时移走 `packages/*/dist` 后 `turbo run types:check --force` | **12/12 通过，41.4s** —— verify job 不需要先 build（contract 的 `exports.types` 指向 `src/*.ts`） |
| `pnpm deploy --prod` 可用性 | `pnpm deploy --legacy --filter=@walnut/server --prod <dir>` | ✓ 成功（18.8s / 31.4s）；产物含 `dist/apps/api/src/main.js`；node_modules 仅生产依赖（playwright/eslint/@swc/core 均不存在） |
| 产物体积 | — | 268.6 MB / 41561 文件（node_modules 255MB、dist 6.6MB、apps 6.4MB） |
| 密钥泄漏面 | 检查产物目录 | `env-local/`、`env-encrypted/` **存在**（旧流程会把它们 COPY 进镜像）→ 已加两层剔除 |
| admin 生产构建 | `pnpm build:admin` | ✓ 178.9s（vite 2m22s）；dist 12.68MB / 1470 文件，含 489 `.br` + 489 `.gz` |
| deploy 与工作区状态 | deploy 前后检查 `.modules.yaml` / `.bin/vite` | ⚠️ 发现 `pnpm deploy --prod` 会把工作区标成 `devDependencies: false`，之后任何 pnpm 命令触发 prune、`vite` 消失（与 staging 目录位置无关）→ 已在 release.yml 强制"deploy 是最后一个 pnpm 命令" |
| 全量安装恢复 | `pnpm install` | ✓ 4.3–7.5s（store 命中），devDeps 全部回来 |
| 自查修复（自己写错的地方） | 审阅 `docker-bake.hcl` | 一度定义了 `SERVER_CONTEXT`/`FRONTEND_CONTEXT` 变量却没在 target 里引用（CI 会找不到 staging 目录）→ 已改为 `context = SERVER_CONTEXT` |

未能在本地验证的部分（本机无 Docker，属预期）：

- `docker build` / `docker buildx bake` 实际执行（Dockerfile 只用了 `FROM` + `COPY`，未使用需要额外验证的特性：无 `contexts=` 命名上下文、无 `dependsOn`、无 cache mount）
- compose 侧 `--wait`（部署脚本按 compose 版本自动降级）
- 跨境推送耗时（由 CI 首跑的 run summary 给出真实数字）

## 5. 上线后要做的验证（CI 首跑）

1. **CI**：push 后确认 CI run 有 job（不再 0 job）；看 Affected 范围表；确认门禁真的在跑（不是 skipped）
2. **发布**：`pnpm release` 打 tag 后确认四个 job 依次通过；记录 run summary 里的 staging 体积与镜像 digest
3. **镜像**：`docker run --rm --entrypoint ls <backend> /app/env-local` 应报不存在（密钥剔除生效）
4. **部署**：日志里应有"三个镜像均存在"、部署前后 `docker compose ps` 两次输出、`--wait` 生效、健康检查 HTTP 200/301/302
5. **缓存**：第二次发布（Re-run all jobs）应明显更快；buildx 日志出现 `scope=backend` / `scope=frontend`
6. **回滚演练**：`workflow_dispatch` 填上一个 tag → 1–3 分钟内恢复

## 6. 回退方式

| 想回退的东西 | 做法 |
|--------------|------|
| 触发方式（回到手动构建） | `release.yml` 的 `on` 换回 `workflow_dispatch`，把 `images` job 的构建步骤搬回 `deploy.yml` |
| 薄镜像（回到镜像内构建） | `git revert` 两个 Dockerfile + `docker-bake.hcl` + release.yml 的 staging 步骤；旧多阶段 Dockerfile 在 git 历史里（commit 前的版本） |
| affected 自检太严格 | 删掉 ci.yml 的 "Affected set sanity check" 步骤（其余不受影响） |
| workflow-lint 门禁 | 删除 `.github/workflows/workflow-lint.yml`，并从 pre-push 移除 `pnpm lint:workflows` |

## 7. 遗留与后续（未做，非本次范围）

- TCR 旧 tag 自动清理（个人版单镜像 100 版本上限）；当前靠 staging 体积/digest 记录人工观察
- `turbo.json` 里 `@walnut/{client,http,types,ui}#build` 的 `no output files found` 警告（这几个包是源码直消费，属既有现象）
- 若要进一步压缩跨境推送：评估国内 self-hosted runner（需额外支出，另行确认）；或 `compression=zstd`（需确认 TCR 支持）
- GitHub Environments（P2-11）未启用：目前用 `workflow_dispatch` 的 environment 选项 + `concurrency: deploy-prod` 保证串行
