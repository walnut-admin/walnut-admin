# CI/CD 与容器构建

> 本文描述当前的 CI/CD 设计与容器构建方式：**commit 只跑质量门禁、tag 才构建镜像、部署不再构建**。
> 运维操作（服务器初始化、回滚、证书更换）见仓库 `deploy/README.md`。
> 历史设计与实施记录见 [归档文档](/content/archive/2026-09-21-ci-cd-pipeline-plan)。

## 触发矩阵

| Workflow | 触发 | 内容 | 是否会构建容器 |
|----------|------|------|----------------|
| `ci.yml` | push `main`、PR | boundaries → affected lint/types:check/test → 根级配置 lint（`pnpm lint:root`，不进 affected 图）→ affected 自检 → syncpack → `pnpm change check` → server 构建（+ 有 secret 时 admin 构建） | ❌ |
| `workflow-lint.yml` | `.github/**` 变更 | actionlint 校验所有 workflow 与本地 composite action | ❌ |
| `release.yml` | tag `v*.*.*`，或 `workflow_dispatch`（**ref 选那个 tag**） | verify ∥ images → GitHub Release → 自动部署；手动补跑时可勾 `skip_deploy` —— **只验证镜像构建、不碰生产** | ✅ 仅此一处 |
| `deploy.yml` | `workflow_call`（被 release 复用）/ `workflow_dispatch`（回滚重发） | 纯部署：校验镜像存在 → 生成 env → scp → `compose pull && up -d --wait` → 健康检查 → **部署后验证（post-verify）**。入参 `image_tag`（必填）+ `environment`（默认 `prod`，目前只有 `prod`） | ❌ |

发布流仍是 `pnpm release`（pnpm 原生版本管理：`pnpm change` 写意图 → `pnpm version -r` 消费 → git-cliff 逐包渲染 changelog → commit → tag `vX.Y.Z` → push 分支与 tag，见 [发布 & 发版指南](./release.md)）。
**tag 因此成为"只构建一次"的锚点**：失败后在该 run 上点 *Re-run all jobs* 即可，缓存命中后通常个位数分钟。

> **`ci.yml` 的 quality job 现在有 turbo 缓存**（2026-09-23 加）：恢复整个 `.turbo/cache`，
> 于是这条 job 里跑过的 turbo 任务（lint / types:check / test）都能跨 run 命中 ——
> 这三类任务的 `outputs` 是空的，条目只是"这个 hash 跑过且通过了"的元数据。
> **刻意不把 admin / server 的 build 搬进来**：那两份产物才是本地那份 385 MB 的主体，搬运费吃掉收益。
> key 用 rolling（带本次 `sha` + `restore-keys` 前缀），否则缓存会**冻在第一次写入那一版**。
> ⚠️ 范围的实际口径是「**这条 job 里 turbo 跑过什么**」而不是「哪几类任务」：`Docs build (dead-link check)`
> 也是 turbo 任务、也跑在这条 job 里，所以 **docs 构建产物同样进了缓存**（实测首份归档 4.7 MB，
> 其中绝大部分是它）。完整取舍与实测数字见 [Turbo 缓存边界](./turbo-cache-boundary) 第七节。

GitHub Release 的**正文不是 CI 生成的**：`pnpm release` 在打 tag 前把本次发版的整仓段落写进根 `changelog-latest.md`，并**随 release commit 一起提交**；`release.yml` 的 release job checkout 到该 tag 后直接 `body_path: changelog-latest.md`（所以发版机不需要任何能改远端内容的凭据，旧 tag 重跑也能复现同一份正文）。

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

### 镜像仓库的版本上限与清理策略（2026-09-23 决定，待办 P3-17）

腾讯云 **TCR 个人版对单个镜像仓库有 100 个版本的上限**。本仓每次发版推两个 tag
（`vX.Y.Z` + 共享基础镜像 `nginx:brotli`），**长期会顶到上限** —— 顶到之后推送开始失败，
而失败发生在 `release.yml` 的 `images` job 里，也就是**打 tag 之后**，属于最难受的时机。

**决定：交给 TCR 控制台的生命周期策略（lifecycle policy），不在 `release.yml` 里加清理步骤。**
理由：清理是仓库侧的运维策略，不是构建流水线的职责；写进 workflow 会多一段需要维护、且只能
在真发版时才能验证的脚本（本机无 Docker，改坏了要等下一次发版才发现）。控制台侧配置一次即可，
且能同时覆盖手工推送的历史镜像。

**配置位置**：TCR 控制台 → 命名空间 → 镜像仓库 → 生命周期策略。建议「保留最近 N 个 tag」
（N 取 20 上下，留足回滚余量），并**排除 `nginx:brotli`** —— 它是被 `frontend` 镜像 `FROM` 的
基础镜像，删掉会让回滚时拉不到基础层。

> ⚠️ 这条**没有机械判据**：控制台配置不在仓库里，`pnpm prepush` / CI 都看不见它。
> 若哪天推送开始报版本数超限，先来这一节。想改成脚本化清理时，落点是 `release.yml` 的
> `images` job（在 bake 之前删旧 tag）。

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

## 部署后验证（post-verify）

部署不是"容器起来就算成功"。`deploy.yml` 的最后一步会在服务器上跑 `deploy/post-verify.sh`：**每 5 秒轮询一次、默认 2 分钟**，检查

| 检查项 | 为什么 |
|--------|--------|
| 容器状态 + **重启次数** | `restart: always` 会把"崩溃 → 重启"伪装成"一直 running"，只看状态会被骗 |
| 运行中的镜像 tag | 防"部署日志说成功、容器其实还是旧镜像"（比对 `.env` 的 `IMG_TAG`） |
| 后端日志 | 无 `Nest can't resolve` / `MODULE_NOT_FOUND` / `EADDRINUSE` / `MongoServerError` / `ECONNREFUSED` 等；且必须出现启动标记 `APP is running in` |
| 前端 / 入口 nginx 日志 | 无 5xx |
| 端到端 | 经公网域名（`--resolve` 指回本机）前端 `/` = 200、API 静态路由 = 200 |
| 安全响应头 | **两个域名各取一次响应头**：`Strict-Transport-Security` / `X-Content-Type-Options` / `X-Frame-Options` / `Referrer-Policy` 必须都在（只比头名、不比取值 —— 取值会随运维调整，逐字比对是误报源） |

任一硬条件在超时前不满足 → 该步骤失败，**部署不判成功**，并打印后端 / nginx 日志尾部。在 Actions 里看 `deploy` job 的 **Post-deploy verification** 步骤。

三个实现细节值得记住：

1. **nginx 日志能进 `docker logs` 是特意做的**：alpine 的 nginx 包默认把 access/error log 写进 `/var/log/nginx/*.log`，容器里 `docker logs` 是空的。`deploy/nginx/Dockerfile` 用两个软链接到 stdout/stderr（官方 nginx 镜像的做法），入口 nginx 与 frontend 共用同一基础镜像，因此都生效。
2. **失败模式写成了可执行测试**：`deploy/post-verify.test.sh` 用假的 `docker`/`curl` 逐条覆盖上面每一个失败分支（含「只有 API 域名缺头」这一种），本地 `bash deploy/post-verify.test.sh` 即可跑，不需要 Docker。
3. **安全头这条判据有两个面，缺一不可**：推送前 `pnpm lint:nginx-headers` 静态查 `deploy/nginx/conf.d/` 里的配置有没有写全（毫秒级），部署后这一段查「头真的发出去了没有」。**为什么两边都要**：nginx 的 `add_header` 是**整段替换而不是合并** —— 某个 `location` 自己写一条就把 server 级的全吃掉；两个并列的 `server` 块之间也不互相继承（2026-09-23 交叉对比时实测：`api.conf` 当时一个安全头都没有）。配置写错要在推送上就拦住，环境/drift（比如 conf 改了没 `nginx -s reload`）只能部署后看得见。

## 源码密钥形态（`pnpm lint:secrets`）

产物侧那道门禁（下一节）看的是**发出去的东西**；这一道看的是**仓库里的文本文件**。它存在的直接原因是 2026-09-23 的一次真实事故：

我在一个**测试夹具**里写了腾讯云文档上那个样本 SecretId（`AKID` + 32 位），当时 **14 段 prepush 门禁 + 300 多个用例全绿** —— 然后 `git push` 被 **GitHub 服务端的 push protection 拒掉**，整条 push 推不上去：

```text
remote:  Push cannot contain secrets
remote:    - commit: …  path: packages/tooling/scripts/src/ci/__tests__/check-dist-secrets.test.ts
remote:       —— Tencent Cloud Secret ID ——
```

三点教训，直接决定了这道门禁的形态：

1. **服务端那道闸在 CI 之前** —— 命中就拒 push，CI 根本轮不到跑。所以它必须在 **`prepush`** 里拦；只在 CI 里拦等于没有（那时 push 已经失败了）。CI 里那一份是补第二道，覆盖"绕过钩子直接推"的情形。
2. **它只认形状，分不出样本与真货**。本仓的规矩因此是：**假样本也不许长成真凭据的形状** —— 夹具请**运行时拼装**（`` `AKIA${'IOSFODNN7EXAMPLE'}` ``、`` `AKID${'x'.repeat(32)}` ``），**不要**往门禁里加白名单：那道服务端的闸不会读我们的白名单。
3. **规则表与产物侧同源**：两边共用 `check-dist-secrets.ts` 的 `scanText`（PEM 私钥要带 base64 正体 / 带凭据的连接串 / JWT 三段 / 云厂商 AK 形状）。源码侧另立一套必然与产物侧漂移。

扫描面是 `git ls-files` **∪ 未跟踪且未被忽略**（所以**刚写下、还没 `git add` 的夹具也会被扫到** —— 这道门禁的价值全在"在 push 之前"）。`.gitignore` 覆盖的东西不在面内：`env-local/` 正是靠这个被排除的（它本来就是明文 env，但**不入库**，不该按"仓库里的凭据"报）。超过 4 MB 的文件跳过，但**跳过哪些会打印出来**（静默跳过是最容易变成假绿的地方）。

判据按实测收窄过一处：连接串的**口令必须"像真口令"（长度 ≥ 8 且含非数字）**。拿同一份规则表扫全仓 2064 个文本文件时，5 处命中里有 4 处是格式说明与本地容器默认口令（`mongodb://u:p@`、bitnami 的 `root:123456@127.0.0.1`）—— 这正是「宁可漏报不可误报」的取舍。

## 产物去密体检（`pnpm lint:dist`）

前端产物是**公开文件**（DevTools 里能看到全部字节），而"把后端 env 泄进前端"在本仓有一条现成的、静默的路径：`apps/server/env-local/` 与 `apps/admin/env-local/` 是**两套** env（都由 `pnpm setup-env` 解密），搬错一行、或被某个 import 间接读到，值就会被打包进去 —— 而构建、类型检查、lint、测试**全都不会响**。之前产物侧是**零门禁**。

`ci.yml` 的 build job 里它紧跟 `Build admin`（扫的就是 `dist`，没有构建就没有体检对象），CI 之外也可以在本地对着已有的 `dist` 直接跑。

**机密源只有 `apps/server/env-local/`**：`apps/admin/env-local/` 里全是 `VITE_*`，它们**本来就该进产物**（Vite 在构建时把这些键替换成字面量 —— 实测产物里连 `VITE_` 这个词都搜不到，0 个）。拿前端 env 当机密源等于 100% 误报。

判据与**被否掉的规则**都写在 `check-dist-secrets.ts` 顶部那张表里，这里只留结论 —— 因为"为什么不要某条规则"比规则本身更容易被后人改回去：

- 采纳：真 PEM 私钥（头 + ≥100 字符 base64 正体）／带凭据的 `mongodb://u:p@`、`redis://:pw@`／JWT 三段／云厂商 AK 形状（`AKIA…`、`AKID…`）／不该发布的文件名（`.env*`、`*.pem`、`*.key`…）／**产物里出现后端 env 的机密值**（最硬的一条）。
- **否掉**（都在真产物上试过，全是误报）：裸 PEM 头（命中的是 WebCrypto 的模板常量）／「机密词键名 = 值」正则（命中的是演示账号与 localStorage 键名枚举）／超长 base64（命中的是内联 data-URI 图片）／熵值分析。
- finding **只报键名与文件、永不回显值** —— 它进的是 CI 日志，那是公开面；用例里有一条专门钉这件事。

## 本地验证 CI 改动

```bash
pnpm lint:workflows    # actionlint（未安装则跳过并提示；CI 中强制执行）
pnpm lint:secrets      # 源码密钥形态（**推送前就该跑** —— 服务端的 push protection 比 CI 更早）
pnpm lint:dist         # 产物去密体检（先构建出 apps/admin/dist；没有产物会以「前置条件未满足」退出 2）
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
