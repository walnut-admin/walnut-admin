# 批次 3 · R2 worker 生产面实施报告（D3=A：真接线）

> 任务：`b3-r2-worker`｜执行者：全新实施 Agent｜HEAD `c4291678`
> 依据：`reports/batch-3/r1-verification.md` §2（任务 B）实测结论，逐条落地。
> 工作树**起步就不是 clean**：`apps/server/libs/**`（CAP P1）与 `apps/admin`、`apps/docs` 有并发同伴的改动，
> 本轮**一个字节都没碰**（见 §7.1 的 diff 归属表）。**未 git commit**（按任务书）。

## 0. 改了什么（4 个文件）

| # | 文件 | 位置 | 内容 |
|---|------|------|------|
| 1 | `deploy/docker-compose.yml` | `backend.environment` `:29-35` | `WORKER_STANDALONE=true`（让位 cron / bootstrap） |
| 2 | `deploy/docker-compose.yml` | 新 service `:58-88` | `worker`：同 image + `command` 覆盖 + 容器 `environment` + `depends_on`(pg/redis healthy) + `restart: always` + **无 healthcheck** + 日志独立目录 |
| 3 | `.github/workflows/ci.yml` | `openapi` job `:391-431` | 「Worker smoke (cron registered)」：`NODE_ENV=development` 起 worker → 轮询等 `cron jobs: [1-9]` → SIGTERM 收场 → 断言（`0` 也红） |
| 4 | `apps/server/Dockerfile` | `:40-50` | 结论注释：**不需要第二入口 / 第二 stage**（理由见 §2） |
| 5 | `apps/server/apps/worker/README.md` | `:16-23` 改写、`:50-96` 新增 | 新增「## 生产如何跑（compose）」：compose service / 单实例约束 / 冒烟命令 |

---

## 1. compose：worker service（§2.2 的清单逐项落地）

`deploy/docker-compose.yml:58-88`：

```yaml
  worker:
    image: ccr.ccs.tencentyun.com/tron1997/backend:${IMG_TAG}
    restart: always
    container_name: walnut-worker
    command: ['node', 'dist/apps/worker/src/main.js']
    environment:
      - WORKER_STANDALONE=true
    volumes:
      - ./env/.env.production:/app/env-local/.env.production:ro
      - ./logs/worker:/app/logs
    depends_on:
      postgres: { condition: service_healthy }   # 文件里是展开写法
      redis:    { condition: service_healthy }
    # 不写 healthcheck（注释里写明了原因）
```

| 项 | 落地 | 对应 R1 结论 |
|----|------|--------------|
| 同镜像 | 与 backend 完全同一个 `image` | §2.1「同镜像不同 CMD 可行」 |
| command | `['node','dist/apps/worker/src/main.js']`，cwd 由镜像 `WORKDIR /app`（`apps/server/Dockerfile:18`）提供 | 不走 `pnpm start:worker`（cross-env 是 devDep） |
| env | **容器 `environment`**，不是 `.env.production` | §2.1：`schedule.composition.ts:24-26` 在模块定义期求值 |
| depends_on | pg / redis 都 `service_healthy` | 启动即连 PG（TypeORM）+ Redis（Bull/缓存） |
| restart | `always` | worker 崩了没有探针能发现，只能靠重启 |
| healthcheck | **无** | `apps/worker/src/main.ts:21` 是 `createApplicationContext`，没有监听端口 |
| 日志 | `./logs/worker:/app/logs`（backend 仍是 `./logs`） | 避免 winston-daily-rotate 的两个进程对同一批按天文件做 rename 竞争 |
| nginx | 未改 | worker 不接流量 |

**一处必须写进注释的语义**（已写）：设了 backend 的 `WORKER_STANDALONE=true` 而 worker 没起 = **零 `@Cron` tick**
（不是延后），所以「要关 worker 就连 backend 那条 env 一起撤」。这条同时写进了 worker README 的生产小节。

## 2. Dockerfile：结论是「不需要第二入口」，已写进注释

`apps/server/Dockerfile:40-50` 新增注释，依据是 R1 §2.1 的两条实测：

1. `infra/nest/prod.json:52` 的 **`filenames`** 里就有 `apps/worker/src` —— 这是真正的编译输入清单
   （SWC 的落点 = `path.relative(apps/server, 源文件)` 的镜像），所以一次 `nest build api` 同时产出
   `dist/apps/api/src/main.js` 与 `dist/apps/worker/src/main.js`；
2. i18n / views 资产由 api 与 worker **两个 project** 的 `assets` 各自拷进同一份 dist（`prod.json:66-82`、`:416-427`）。

本轮又亲自复核了一次（§6.1）：`pnpm --filter @walnut/server build` 之后
`dist/apps/worker/src/main.js` = True，`dist/apps/api/src/main.js` = True。

**顺带纠正一处引用**：R1 引的 `build/image/server/Dockerfile:36` 是 **gitignored 的构建上下文副本**
（`.gitignore:43` 的 `build/image/`，由 `deploy/README.md:187` 用 `cp apps/server/Dockerfile ...` 生成，且该副本当前已落后于源文件）。
**真源是跟踪进仓的 `apps/server/Dockerfile`**，所以注释写在源文件里（`:40-50`）；镜像 CMD 在源文件是 `:50`，不是 `:36`。

## 3. api 服务也设了 `WORKER_STANDALONE=true`

`deploy/docker-compose.yml:29-35`，四个要点写进注释：必须容器 env（模块定义期）、漏了 = 双跑同一批 `@Cron`、
设了但 worker 没起 = 零 tick、来源是 `apps/worker/README.md` 的部署契约。

## 4. CI 冒烟（`ci.yml` 的 `openapi` job，`:391-431`）

实现刻意与 R1 §2.3 对齐，**并与任务书的「等约 9.5s」有一处口径差异**：

```yaml
      - name: Worker smoke (cron registered)
        if: env.DOTENVX_KEYS != ''
        working-directory: apps/server
        run: |
          set -euo pipefail
          pnpm build
          log="$(mktemp)"
          start=$(date +%s)
          NODE_ENV=development WORKER_STANDALONE=true WALNUT_ADMIN_BOOTSTRAP_TASKS=off \
            node dist/apps/worker/src/main.js >"$log" 2>&1 &
          pid=$!
          for _ in $(seq 1 40); do
            if grep -qE 'cron jobs: [1-9][0-9]*' "$log"; then break; fi
            if ! kill -0 "$pid" 2>/dev/null; then break; fi
            sleep 1
          done
          kill -TERM "$pid" 2>/dev/null || true
          wait "$pid" 2>/dev/null || true
          echo "waited $(( $(date +%s) - start ))s for the worker to register cron jobs"
          tail -n 5 "$log"
          grep -E 'cron jobs: [1-9][0-9]*' "$log"
```

| 任务书要求 | 落地 | 说明 |
|------------|------|------|
| 塞进已有 PG/Redis 的 openapi job | ✅ `ci.yml:406` | 位置在 `Apply migrations`(`:381`) 与 `OpenAPI drift check`(`:386`) 之后 |
| `NODE_ENV=development` | ✅ `ci.yml:416` | R1 坑①：production 会被 `libs/config/src/utils/pg-app-password.ts:45` 拒绝 |
| 等约 9.5s | ⚠ **改成轮询（命中即走，40×1s 兜底）** | 固定 sleep 9.5s 在本机实测 6.3 / 7 / 8s 就命中，纯等待；而 runner 更慢时固定 9.5s 会随机红 —— R1 §2.3 的结论也是「轮询 + 超时兜底，不要固定 sleep」 |
| 断言 `cron jobs: [1-9]` | ✅ `ci.yml:431` | 断言是**最后一条命令** ⇒ grep 不到 = step 红 |
| `0` 也要红 | ✅ 正则就是 `[1-9][0-9]*` | 负对照实测见 §6.4 |
| 然后退出 | ✅ SIGTERM + `wait` | 靠 `apps/worker/src/main.ts:26` 的 `enableShutdownHooks`；进程提前死掉也有 `kill -0` 立即跳循环，不会空等 |
| 约 +25s | 实测 **+12s**（本机，含 `pnpm build` 约 4s + 等 7s + 收场） | 任务书的 25s 是保守值 |

三个刻意的取舍（都写进了 `ci.yml:391-405` 的注释）：

1. **用 `pnpm build`（api 生产构建）而不是 R1 建议的 `pnpm build:worker`**：镜像里的 dist 就是
   `nest build api -c infra/nest/prod.json` 产的，用它才能断言「**生产构建产物**里 worker 跑得起来」；
   顺带把 `verify-build-assets` 的 4 项资产校验也跑了一遍。副作用：它会 `deleteOutDir` 清掉前面
   `openapi:export` 建的 dist —— 本步是 job 最后一步，无后续步骤依赖 dist。
2. **`WALNUT_ADMIN_BOOTSTRAP_TASKS=off`**：否则 worker 启动即跑 bootstrap 任务（含 `rotateAppKey()`），CI 里是副作用；
   它只隔离 bootstrap、不影响 cron 注册（ADR 0025），所以计数断言依旧有效。
3. **冒烟同时机械守住 `prod.json:52`**：若哪天 `filenames` 丢了 `apps/worker/src`，入口文件消失 ⇒ 本步红，
   而不是等上线后才发现「镜像里没有 worker」。

## 5. 文档：`apps/server/apps/worker/README.md`

- `:16-23` 改写：原话「**不要为它单独建 compose 服务**」与本次落地直接冲突，已改成
  「不做每个 app 一个镜像 / 一个构建 target；生产编排里它只是**同镜像的第二个 service**」。
- `:50-96` 新增「## 生产如何跑（compose）」：
  - compose service 的形态（同镜像 / command 覆盖 / 无 healthcheck / 日志独立目录 / `up -d --wait` 对无探针服务只要求 running）；
  - **两处 `WORKER_STANDALONE=true` 都在容器 `environment`**，以及为什么不能只写 env 文件；
  - **单实例约束**（1 api + 0/1 worker，`--scale worker=2` 会双跑；`@Cron` 无分布式锁）+ 关 worker 必须同时撤 backend 的 env；
  - 上线后自查（`docker logs walnut-worker | grep 'cron jobs'` + api 的 `[WorkerStandalone]` warn）；
  - **冒烟小节**：CI 步骤名、判据（`0` 也红）、本机等价命令、三个坑（production 守卫 / 冷 require ~9s 不是 3s / 进程不自己退出）。

## 6. 验收实测

### 6.1 构建（任务书第 1 条）

```
$ cmd /c "pnpm --filter @walnut/server build"
> SWC  Running...
[verify-build-assets] dist 资产校验通过（4 项）
$ cross-env NODE_ENV=production nest build api -c infra/nest/prod.json && node infra/scripts/verify-build-assets.ts dist
Successfully compiled: 955 files with swc (211.38ms)          ← exit 0
dist/apps/api/src/main.js: True
dist/apps/worker/src/main.js: True
dist/apps/api/src/i18n: True
```

（955 而不是 R1 的 954：并发同伴新增了 `libs/const/src/app/cap.ts`，编译清单跟着 +1。）

### 6.2 `pnpm lint:workflows` —— **本机没有 actionlint，改用 yaml 解析自检**

```
$ cmd /c "pnpm lint:workflows"
$ walnut-lint-workflows
⚠ 未检测到 actionlint，跳过 workflow 校验（CI 中会强制执行）      ← exit 0，但这是 SKIP 不是 PASS
```

替代证据（任务书允许的 `node -e` + yaml 解析，脚本用 `packages/tooling/scripts` 的 `yaml` 依赖）：

```
全部结构断言通过（25 条）
  ✓ compose services = 6 个（nginx,frontend,backend,worker,postgres,redis）
  ✓ backend.environment 含 WORKER_STANDALONE=true
  ✓ worker.image 与 backend 同镜像 / command = ["node","dist/apps/worker/src/main.js"]
  ✓ worker.environment 含 WORKER_STANDALONE=true / restart = always / 无 healthcheck
  ✓ worker.depends_on pg/redis = service_healthy
  ✓ worker 日志目录与 backend 分开（./logs/worker:/app/logs）且没有共用 ./logs
  ✓ ci.yml 有 openapi job 与 Worker smoke 步骤（working-directory = apps/server，if = env.DOTENVX_KEYS != ''）
  ✓ run 含 NODE_ENV=development / WORKER_STANDALONE=true / WALNUT_ADMIN_BOOTSTRAP_TASKS=off
  ✓ run 启动 dist/apps/worker/src/main.js、轮询 40 次、SIGTERM + wait、末尾断言 cron jobs: [1-9][0-9]*
  ✓ smoke 在 Apply migrations 之后（6 < 8）
```

补充：`pnpm lint:workflows-shell` 是**真跑**的（Git bash 存在），它把每个 `run:` 块过 `bash -n`：

```
$ cmd /c "pnpm lint:workflows-shell"
workflow shell 语法：4 个文件、74 段 shell 块，bash -n 全部通过     ← exit 0（含新增那段）
```

### 6.3 冒烟逻辑真跑了一遍（把 ci.yml 的 run 块抽出来执行）

从 `ci.yml` 用 yaml 解析**原样抽出**那段 `run`（不是手抄），用 Git bash 在 `apps/server` 下执行
（本机 PG / Redis 在线、`env-local/.env.development` 已解密）：

```
$ bash /tmp/walnut-smoke-extracted.sh
> SWC  Running...
[verify-build-assets] dist 资产校验通过（4 项）
waited 8s for the worker to register cron jobs
[WorkerBootstrap] worker process started (no HTTP listener); cron jobs: 7
   [AppInitSettingsTask, SystemInitLocaleMessageTask, AppAuthDeleteRefreshTask, AppRotateKeyTask,
    SystemUpdateDeviceActiveStatusTask, AppAuthMfaSetupTask, AppAuthDeleteRefreshPgPurgeTask]
bash exit: 0
```

三次独立实测的「等了多少秒」：**6.3s / 7s / 8s**（R1 的 9.1 / 9.3s 是同一判据的不同机器状态）⇒
40s 兜底有约 4–6 倍余量。整段 step（含 `pnpm build`）**12s**。

### 6.4 负对照（证明会红，不是永远绿）

```
$ printf 'cron jobs: 0\n' | grep -E 'cron jobs: [1-9][0-9]*'
grep-on-zero exit: 1                     ← 「进程起来了但 0 个 cron」会被判红
$ bash walnut-smoke-negative.sh          # 把入口路径改成不存在的文件
negative-script exit: 1  elapsed: 5s     ← 非 0，且 5s 就结束（不是空等 40s）
  code: 'MODULE_NOT_FOUND'
```

### 6.5 `pnpm --filter @walnut/scripts test`（确保没破坏 prepush / release 相关用例）

```
$ cmd /c "pnpm --filter @walnut/scripts test"
 ✓ src/ci/__tests__/prepush.test.ts (10 tests) 3319ms
 ✓ src/ci/__tests__/check-workflow-shell.test.ts (12 tests) 6625ms
     ✓ 当前仓库所有 shell 块语法通过
 ✓ src/ci/__tests__/ci-workflow.test.ts (2 tests) 7ms
 Test Files  31 passed (31)
      Tests  512 passed (512)
   Duration  7.45s
```

### 6.6 `docker compose config` —— **Docker 不在本机**

```
$ (Get-Command docker).Source      → 空（未安装 Docker / 无 compose 插件）
```

替代：§6.2 的 yaml 结构自检（25 条断言，含环境变量 / command 数组 / depends_on 条件 / 卷 / 无 healthcheck）。
**注意**：这只证明「YAML 结构与预期键值对」，不等于 `docker compose config` 的插值/规范化校验 ——
真正的语法门禁要等有 Docker 的机器或 CI 跑一次 `docker compose -f deploy/docker-compose.yml config`。

### 6.7 文档门禁（顺手跑了，因为改了 md）

```
$ cmd /c "pnpm lint:docs-refs"
文档引用校验：329 篇活文档；包名豁免 17 条、路径豁免 8 条
✅ 没有引用不存在的包名或路径
```

## 7. 环境观察 / 未验证

### 7.1 diff 归属（我碰的只有 4 个文件）

`git diff --stat` 里与本次相关的只有：`.github/workflows/ci.yml`、`apps/server/Dockerfile`、
`apps/server/apps/worker/README.md`、`deploy/docker-compose.yml`。其余（`apps/server/libs/{cache,guards,security,cookie}`、
`apps/admin/src/utils/axios/**`、`apps/docs/**`、`test/api/DESIGN-ISSUES.md` 等）全是并发同伴的 CAP P1 改动，本轮未触碰。

### 7.2 根 `pnpm build` 在本工作树是红的（与本次无关）

诊断时误在仓库根跑了一次 `pnpm build`，红在 `@walnut/docs#build`：

```
[vitepress] 14 dead link(s) found.
(!) Found dead link ./../../../../../../reports/batch-1/r3be-fixup in file zh-CN\content\industry-research\backend-architecture-review\10-implementation-plan.md
...
```

死链全部指向 `reports/batch-1/*` 与 `09-research-summaries.md` 里的 `./06-CROSS-CHECK` / `./07-DECISIONS`，
是**同伴文档改动带来的既有红**（`apps/docs` 本轮零改动）。需要有人修，否则根 `pnpm build` 与
`build:docs` 都会拦人。

### 7.3 未验证的边界

1. **GitHub ubuntu runner 上的耗时**：本机 6.3–8s，runner 上大概率更快，但**没有**实测。40×1s 兜底是按
   「本机 9s 的 4 倍」定的；若 runner 冷 require 超过 40s（不太可能），本步会红。
2. **冒烟用的是 `NODE_ENV=development`**：所以它验的是「cron 注册链路」，不是「生产 env（真实 `DATABASE_PG_APP_PASS`）
   能不能启动」—— 后者仍只有部署时才知道。
3. **`pnpm deploy --prod` 是否把 gitignored 的 `dist/` 带进镜像上下文**（R1 §3.1 的遗留项）本轮**仍未闭环**：
   跑它会写 `build/image/` 且需要 Linux 侧 staging，超出本轮范围。worker 的入口完全依赖这一条。
4. **compose 的真语法校验**没跑（无 Docker，见 §6.6）。
5. 冒烟**只覆盖首启**：worker 崩了 `restart: always` 会拉起，但「重启后 cron 还挂没挂」没有门禁（也没必要）。

## 需要 Lead 拍板

1. **`deploy/post-verify.sh` 要不要把 worker 加进观察面**（现状：只查 `walnut-backend` / `-frontend` / `-nginx` 三个容器，
   `post-verify.sh:62,95`）。即 `restart: always` 下的崩溃重启循环、worker 完全不存在，部署都判绿 ——
   正是 R1 说的「cron 没挂上是静默的」。最小补丁是加一个 `CONTAINER_WORKER` + 两个循环里各加一项
   + `post-verify.test.sh` 的夹具；但它属于部署关键脚本，本轮没动（我的 bash 行为测试也跑不了真 docker）。
2. **CAP 单实例口径 × worker**：本机起 worker 时日志出现
   `[SecurityCapService] CAP token store = local file (.data/tokensList.json) — CAP MUST run as a SINGLE instance`
   （来自并发同伴的 CAP P1 改动）。它意味着「2 个进程 = 2 个 CAP 实例」，而 compose 里两个容器各有独立 `/app/.data`。
   需要确认：worker 进程是否**根本不该**实例化 CAP（它不接 HTTP），还是 CAP 必须切到共享 Redis —— 这决定
   worker service 要不要额外给 `.data` 卷。**这是 D3=A 真接线后新增的一个跨批次耦合点。**
3. **worker 是「常开」还是「可选」**：本轮按任务书做成**常开**（`restart: always`）+ backend 恒让位，
   代价是「没有 worker 就没有 cron」变成硬约束。如果 Lead 想要「0 worker」的部署形态，就得给 service 加
   `profiles` 并让 backend 的 `WORKER_STANDALONE` 跟着开关 —— 那需要另一套编排，我不建议在本批做。
4. **`deploy/README.md` 的「三个容器」表述**（`:129` 的 post-verify 表格：「三个容器必须 running」）与
   `deploy.yml:233` 的 `docker inspect ... walnut-nginx walnut-frontend walnut-backend` 硬编码清单，
   在加了第 4 个容器后**字面已过时**（不影响功能）。要不要顺手同步，取决于第 1 条怎么定。
5. **`pnpm deploy --prod` 的 dist 遗留验证谁补**（§7.3 第 3 条）—— 这是 worker 生产面唯一的未闭环点：
   若 deploy 产物不带 gitignored `dist`，镜像里就没有 `dist/apps/worker/src/main.js`，compose 会 CrashLoop。
   建议在 Linux runner 上补一条 `test -f build/image/server/dist/apps/worker/src/main.js`。
6. **根 `pnpm build` 的 docs 死链**（§7.2）：与本批无关，但会拦住任何「全量构建」验收，需要有人认领。
