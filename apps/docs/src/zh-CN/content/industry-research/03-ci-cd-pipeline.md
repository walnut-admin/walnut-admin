# CI/CD 流水线设计

> 大型 TypeScript monorepo 的 CI/CD 核心挑战是**速度**和**精准度**——不能每次 push 都重构建整个仓库，也不能漏掉受影响的包。本文档覆盖业界标准的 GitHub Actions 设计模式。

---

## 1. 核心设计原则

### 1.1 四个设计目标

| 目标 | 手段 |
|------|------|
| **只构建变更的**（affected-only） | `turbo --filter='[origin/main]'` |
| **缓存跨机器共享**（remote cache） | Vercel Remote Cache 或 self-hosted |
| **锁定依赖版本**（reproducible） | `pnpm install --frozen-lockfile` |
| **单一 workflow 多环境**（unified pipeline） | 一个 workflow 文件，用 if 分支区分环境 |

### 1.2 任务优先级（执行顺序）

```
代码检出 → pnpm install → format:check → lint → typecheck → test → build → deploy
  (30s)      (60s)           (30s)       (60s)   (90s)       (2min)  (3min)   (按需)
```

**从快到慢排列**——花最少时间抓到最多的错误。如果 lint 没过，就不跑 typecheck；如果 typecheck 没过，就不跑 test；以此类推。

### 1.3 不要重复检查

CI 的设计原则之一是**信任上游门禁**：

- pre-commit 已经跑了 prettier + eslint → CI 里不需要再跑（除非你想做 double-check）
- 如果 pre-commit 被跳过（`git commit --no-verify`），CI 作为最后的防线

---

## 2. 基础 CI Workflow

### 2.1 标准 PR → main pipeline

```yaml
# .github/workflows/ci.yml
name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true  # 新 commit push 后取消旧的 run

jobs:
  quality:
    name: Quality Gates
    runs-on: ubuntu-latest
    timeout-minutes: 15

    steps:
      - name: Checkout
        uses: actions/checkout@v4
        with:
          fetch-depth: 0  # ← 必须！turbo 需要 git history 做 affected 计算

      - name: Setup pnpm
        uses: pnpm/action-setup@v4
        # packageManager 字段自动被读取，无需指定 version

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 24
          cache: "pnpm"

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Format check
        run: pnpm format:check

      - name: Lint
        run: pnpm lint

      - name: Type check
        run: pnpm typecheck

      - name: Test
        run: pnpm test

      - name: Build
        run: pnpm build
```

### 2.2 关键细节解释

| 细节 | 为什么重要 |
|------|-----------|
| `fetch-depth: 0` | turbo 的 `--filter='[origin/main]'` 需要完整 git history 才能做 diff |
| `concurrency.cancel-in-progress` | 同一个 PR 连续 push 时自动取消旧的 run，节省 CI 分钟数 |
| `pnpm install --frozen-lockfile` | 如果 `package.json` 和 `pnpm-lock.yaml` 不一致，直接报错而不是悄悄更新 lockfile |
| `timeout-minutes: 15` | 防止卡死，超过 15 分钟自动 kill |
| `pnpm/action-setup@v4` | 自动从 `packageManager` 字段读取 pnpm 版本，不用写死 |

---

## 3. Turbo Remote Cache 集成

### 3.1 Vercel Remote Cache（推荐）

turbo 的 remote cache 允许多个 CI run（甚至开发者本地）共享构建缓存。**同一个包、同样的源码、同样的依赖 → 直接用缓存的构建产物，不重新跑。**

```bash
# 一次性设置
npx turbo login          # 浏览器认证 Vercel 账号
npx turbo link           # 关联仓库到 Vercel project
```

在 CI 中只需要两个环境变量：

```yaml
# GitHub Actions
env:
  TURBO_TOKEN: ${{ secrets.TURBO_TOKEN }}
  TURBO_TEAM: ${{ secrets.TURBO_TEAM }}
```

```bash
# 验证 remote cache 是否生效
turbo build --dry    # 看哪些 task 会被执行
turbo config         # 看 remote cache 状态
```

### 3.2 Self-hosted Remote Cache

如果不能用 Vercel（私有化部署等），可以自己搭：

```bash
# 非官方社区方案
docker run -p 3000:3000 ducktors/turborepo-remote-cache
```

然后：

```bash
npx turbo login --manual --url http://your-server:3000
npx turbo link --url http://your-server:3000
```

---

## 4. Affected-Only Pipeline（进阶）

### 4.1 只构建变更的包

完整的 CI 跑一次可能要 10-15 分钟。但如果只是改了 `apps/admin` 里一个页面组件，为什么要重构建 `@walnut/contract` 和 `apps/server`？

```yaml
# .github/workflows/ci.yml — affected-only 版本
jobs:
  quality:
    steps:
      # ... checkout, setup, install 同上 ...

      - name: Quality gates (affected only)
        run: |
          # 计算 origin/main 以来变更的包及其依赖
          TURBO_FILTER="--filter='[origin/main]'"
          pnpm turbo run lint typecheck test build ${TURBO_FILTER}
```

### 4.2 三种 filter 模式

```bash
# 1. 只构建变更的包自己（不构建其依赖或依赖者）
turbo build --filter='[origin/main]'

# 2. 构建变更的包 + 它的所有上游依赖
turbo build --filter='[origin/main]...'

# 3. 构建变更的包 + 它的所有下游依赖者
turbo build --filter='...[origin/main]'

# 4. 微调：先构建上游，再构建变更包自身
turbo build --filter='...[origin/main]...'
```

**什么时候用哪种：**

| 场景 | filter |
|------|--------|
| PR quality check（lint + typecheck） | `[origin/main]` |
| 构建发布产物 | `[origin/main]...`（先构建依赖） |
| 验证不会 break 下游 | `...[origin/main]`（也检查依赖者） |

---

## 5. 部署 Pipeline

### 5.1 分离构建与部署

构建和部署应该在不同的 job 中，通过 artifact 传递产物：

```yaml
jobs:
  # Job 1: 构建（可以 parallel by package）
  build:
    strategy:
      matrix:
        package:
          - name: "@walnut/admin"
            output: "apps/admin/dist"
          - name: "@walnut/server"
            output: "apps/server/dist"
    steps:
      - uses: actions/checkout@v4
      # ... setup ...
      - run: pnpm turbo build --filter=${{ matrix.package.name }}
      - uses: actions/upload-artifact@v4
        with:
          name: ${{ matrix.package.name }}-dist
          path: ${{ matrix.package.output }}

  # Job 2: 部署（串联，前端后后端？还是前后端并行？）
  deploy-admin:
    needs: build
    if: github.ref == 'refs/heads/main'
    steps:
      - uses: actions/download-artifact@v4
        with:
          name: "@walnut/admin-dist"
          path: apps/admin/dist
      # ... deploy to CDN / S3 / Vercel ...

  deploy-server:
    needs: build
    if: github.ref == 'refs/heads/main'
    steps:
      - uses: actions/download-artifact@v4
        with:
          name: "@walnut/server-dist"
          path: apps/server/dist
      # ... deploy to server / Docker registry ...
```

### 5.2 Docker 构建策略

```dockerfile
# Dockerfile — 生产镜像，只包含生产依赖
FROM node:24-alpine AS base
RUN corepack enable && corepack prepare pnpm@latest --activate

FROM base AS deps
WORKDIR /app
COPY pnpm-lock.yaml pnpm-workspace.yaml ./
COPY package.json .
COPY apps/server/package.json apps/server/
COPY packages/contract/package.json packages/contract/
# ... 只复制服务器需要的 workspace 包 ...

RUN pnpm install --frozen-lockfile --prod  # ← 只安装生产依赖

FROM base AS builder
# ... 同上，但 pnpm install 所有依赖 ...
RUN pnpm turbo build --filter=@walnut/server

FROM base AS runner
COPY --from=deps /app/node_modules ./node_modules
COPY --from=builder /app/apps/server/dist ./dist
EXPOSE 3000
CMD ["node", "dist/main.js"]
```

**关键原则**：
- Dockerfile 放 `apps/server/Dockerfile`，不放在根目录
- 用多阶段构建，最终镜像只包含运行时需要的文件
- `pnpm deploy --filter` 命令也可以用来精简（不过更复杂的 monorepo 才有收益）

---

## 6. CI 环境变量管理

### 6.1 哪些放 GitHub Secrets

| 环境变量 | 存储位置 | 说明 |
|---------|---------|------|
| `TURBO_TOKEN` | GitHub Secrets | Remote cache 认证 |
| `TURBO_TEAM` | GitHub Variables（非 Secrets） | 不敏感，但不想 hardcode |
| `NPM_TOKEN` | GitHub Secrets | npm 发布认证 |
| `NODE_ENV` | 写在 workflow 文件中 | 非敏感 |
| 应用私密变量 | GitHub Secrets + Environments | 按环境隔离 |

### 6.2 GitHub Environments（多环境部署）

```yaml
deploy-staging:
  needs: build
  environment:
    name: staging
    url: https://staging.walnut-admin.com
  steps:
    - run: pnpm turbo deploy --filter=@walnut/admin

deploy-production:
  needs: [deploy-staging]
  environment:
    name: production
    url: https://www.walnut-admin.com
  steps:
    - run: pnpm turbo deploy --filter=@walnut/admin
```

---

## 7. Release Workflow（配合 Changesets）

```yaml
# .github/workflows/release.yml
name: Release

on:
  push:
    branches: [main]

concurrency: ${{ github.workflow }}-${{ github.ref }}

jobs:
  release:
    runs-on: ubuntu-latest
    permissions:
      contents: write        # 写 commit + tag
      pull-requests: write   # 创建 Version Packages PR
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 24
          cache: "pnpm"

      - run: pnpm install --frozen-lockfile

      - name: Create Release PR or Publish
        uses: changesets/action@v1
        with:
          version: pnpm changeset version
          publish: pnpm changeset publish
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          NPM_TOKEN: ${{ secrets.NPM_TOKEN }}
```

> 详细讨论见 [06-versioning-and-changelog.md](./06-versioning-and-changelog.md)。

---

## 8. CI 性能优化清单

| 优化项 | 预期收益 |
|--------|---------|
| **pnpm cache**（`actions/setup-node` 的 `cache: "pnpm"`） | install 从 60s → 15s |
| **turbo remote cache**（Vercel 或 self-hosted） | build 从 3min → 200ms（cache hit） |
| **affected-only**（`--filter='[origin/main]'`） | 不跑未变更的包 |
| **concurrency cancel** | 同一 PR 多次 push 不排队 |
| **fetch-depth: 0**（但用 `--filter=blob:none`） | checkout 更快（对大仓库有意义） |
| **分开 job**（lint/test 与 build 不同 job） | 并行跑 |
| **timeout-minutes** | 防止卡住浪费分钟数 |

---

## 9. 与 Walnut Admin 的映射

| 本文建议 | Walnut Admin 现状 | 差距 |
|---------|-------------------|------|
| affected-only CI | ❌ ADR-0009 CI 流程尚未实现 | 待实现 |
| turbo remote cache | ❌ 未配置 | 推荐加上（免费，收益大） |
| `--frozen-lockfile` | ❓ 待确认 | 保守用 `--frozen-lockfile` |
| Changesets release workflow | ⚠️ ADR-0011 已决定，待实现 | 待实现 |
| Docker 多阶段构建 | ❓ 待确认 | 如部署到 K8s/Docker，需加上 |
| GitHub Environments | ❓ 待确认 | 有多环境部署需求时加 |
