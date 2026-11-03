# 批次 4 · R2（packages 收拾）实施报告

- 执行者：b4-r2-pkg（全新 agent）
- 基线：`HEAD efe65493`，开工时工作树 clean
- 日期：2026-11-03
- 范围：D6 / D7 / D8 / D9 / D20（未 commit）
- 本报告的所有数字都是**实测**；命令与输出片段见各节

> 并行提示：本批与 `b4-r2-wire` 同时在同一工作树上跑。它按约定改了
> `packages/platform-any/contract/src/pagination.ts`、`apps/server/libs/{list,repository}`、
> `apps/admin/src/hooks/web/useTableAPIListParams.ts`、controller 与 .vue —— 本次核对过：
> 这些文件我一个都没动（唯一例外：另有两个 admin 文件被我用 `eslint --fix` 重排过 import，
> 见 §6.2 末段与 §9）。

## 0. 一句话结论

五个决策都已落地，**判据里的每一条门禁最终全绿**（含 `pnpm lint` / `pnpm types:check` /
`pnpm --filter @walnut/admin build`），全部未 commit。

过程中有**一轮红**，全部来自与 `b4-r2-wire` 共用同一工作树：它的 list-wire 改动先让
`types:check` 红（`params.query` 8 条）、让 admin 的 2 个文件 import 顺序红；它自己改完后
这两处自动消失。我另外把 2 个文件里的 import 顺序用 `eslint --fix` 修掉才让 build 转绿 ——
**这是本次唯一越出「packages/** + admin 的 import 机械替换 + server 的 public/」改动面的地方**，
逐条登记在 §6.2 与 §9。

## 1. D8 · 删桶（`client` / `http`），`api-types` 桶保留

### 1.1 动手前的前置核对（0 消费必须先证明）

```bash
git grep -n -E "from '@walnut/client'"  -- . ':!*.md' ':!pnpm-lock.yaml'   # 0 条
git grep -n -E "from '@walnut/http'"    -- . ':!*.md' ':!pnpm-lock.yaml'   # 0 条
git grep -n -E "from '@walnut/utils'"   -- . ':!*.md' ':!pnpm-lock.yaml'   # 0 条
```

裸包名（不带子路径）import 站点在三个包上都是 **0** —— 这一条不成立就不能删，先报 Lead。

### 1.2 桶的导出量与消费面（用 `git show HEAD:<file>` 逐个解析，去重后计名）

| 包 | 桶具名导出 | 裸包名 import 站点 | 走子路径的文件 | 裁决 |
|---|---|---|---|---|
| `@walnut/client` | 54 | 0 | 95 | 删 |
| `@walnut/http` | 15 | 0 | 8 | 删 |
| `@walnut/api-types` | 58（生成别名） | 79 个文件 | 0 | **保留** |

> 决策书写的是「三桶 75 导出」，实测是 client 54 + http 15 = **69**（`ui` 已于批次 1 删除，
> 所以 `platform-web` 现在只剩两个桶）。75 这个数与任何一种量法都对不上（含 utils 的 30 则是 99），
> 已在 §6.2 登记，不影响裁决。

### 1.3 改了什么

- `packages/platform-web/client/src/index.ts` —— 删除（54 导出）
- `packages/platform-web/http/src/index.ts` —— 删除（15 导出）
- 两个包的 `package.json`：删掉 `exports["."]`，保留 `./*`（client 另保留 `./types/*`）
- `knip.config.ts:156-172` —— 这两个包不再声明 `entry: ['src/index.ts']`（指向已删文件是配置错误），
  改为从 `exports` 的 `./*` 通配推导，与 `packages/tooling/*` 同口径；并在注释里写清「为什么之前
  knip 一边报这些导出未用、一边说不出谁该用」
- 两个包的 `README.md` 导出面改写：表格从「`.` + `./*`」变成「`./*` 就是公共面」，并给出
  「原桶里的符号现在在哪个子路径」的对照表（http 的 6 行表，client 的分组表）
- `apps/docs/.../adr/0013-barrel-exports-policy.md` —— **按决策改写判据**（见 §1.4）

### 1.4 ADR 0013 的新判据

旧判据是「包入口一律做选择性桶」，新判据是**桶的必要性由真实消费者决定**：

```text
该包有没有本仓之外的消费者（发布出去的包）？
|- 有  -> 必须有桶（仓外消费者唯一稳定的公共 API 面）
|- 没有 -> 数裸包名 import 站点：> 0 保留；= 0 删掉（连 exports["."] 一起删）
```

判据是机械的、可重跑的（`git grep -nE "from '@walnut/<pkg>'" | wc -l`），
并由 `pnpm lint:exports` 的 `exports-target-exists` 兜住「删了文件忘了删 exports」。

> 关于「本仓之外的消费者」这一措辞，本仓当前**没有任何包**属于这一档（全 private）。
> 所以能落地的判据只能是「有没有真实消费者」，而 `api-types` 正是它的另一端：79 个文件
> 全都从桶里取东西（一次改、全体对齐），这与 client/http 的「0 站点」是同一把尺子的两端。
> 我在 ADR 里按这个双层写法落地了（先问仓外，再数仓内站点），如果 Lead 坚持只写「仓外」,
> 那 `api-types` 会被自己的规则判死 —— 见 §7 第 1 条。

### 1.5 验证

```
pnpm lint:exports      -> exit 0（11 个声明了 exports 的包全部成立）
pnpm boundaries        -> exit 0（15 个包 4544 文件，no issues）
```

## 2. D6 · `@walnut/types` 归前端

- `packages/platform-any/types/package.json`：`walnut.platform` `any` -> `web`；
  `description` -> 明确写「后端 0 消费」并注明是 D6 的实测口径
- `packages/platform-any/types/README.md`：头部加「消费者只有前端」+ 平台行改成 `web`，
  并补一行 `turbo 边界 tag`（写清 `platform-any` 是**目录派生**的边界角色、`walnut.platform` 只是
  说明性元数据 —— 两者含义不同，免得下一个人以为哪一处写错了）

实测依据（后端 0 消费的两条独立证据）：

```
apps/server/package.json 的 @walnut/* 依赖 = @walnut/contract, @walnut/utils, @walnut/eslint-config, @walnut/vitest-config（没有 types）
git grep "@walnut/types" -- apps/server   -> 只有注释/无 import
```

> 附带事实：`walnut.platform` 在全仓**没有任何消费者**（`git grep "manifest.walnut"` 0 命中），
> 所以这次改动是纯元数据，不影响任何门禁。

## 3. D7 · `@walnut/utils` 收缩到两件事

### 3.1 判据与结果

判据：**两端是否对同一批字节 / 同一棵树负责**。按此只有两件事留下：

| 留下 | 为什么是双端 |
|---|---|
| `sign-raw`（`buildSignRaw` / `splitPathAndQuery` / `stripApiPrefix`） | 后端 `sign.guard`/`security.guard` 校验的与前端算的必须是**同一段字节**，各算各的必然漂移（漂移的表现是 401） |
| `object-paths`（`objectToPaths` / `pathsToObject`） | 后端审计日志扁平化与前端扁平化是**同一棵树、同一批 key** |

下沉的东西（**17 个运行时值 + 5 个类型**，分布在 6 个文件里）：

| 原位置 | 新位置 | 运行时值 |
|---|---|---|
| `utils-core/src/crypto/const.ts` | `client/src/browser/crypto/const.ts` | `AES_GCM` / `RSA_OAEP` / `PEM`（+ 5 个类型） |
| `utils-core/src/crypto/transformer.ts` | `client/src/browser/crypto/transformer.ts` | 9 个 base64 / hex / uint8 / utf8 变换 |
| `utils-core/src/regex.ts` | `client/src/regex.ts` | `isEmailAddress` / `isPhoneNumber` |
| `utils-core/src/queue.ts` | `client/src/queue.ts` | `SingletonPromise` |
| `utils-core/src/persistent/enhance/sync.ts` | `client/src/persistent/enhance/sync.ts` | `withSyncConditionalEncryption` |
| `utils-core/src/persistent/enhance/async.ts` | `client/src/persistent/enhance/async.ts` | `withAsyncConditionalEncryption` |

> 决策书写「16 个浏览器专用值」，实测口径是 **17 个运行时值**（3 + 9 + 2 + 1 + 2）。
> 差的 1 个最可能是把 `crypto/const` 的三个常量当成「一组」计了一次；不影响裁决，登记在 §6.2。

5 个测试文件跟着实现一起搬（`regex` / `queue` / `crypto/transformer` / `persistent/enhance` ×2），
所以下沉不是「搬代码丢测试」。

### 3.2 下沉后 `@walnut/utils` 的双端消费面（一句话）

> **后端只消费两件事 —— 签名原文（`sign-raw`）与对象扁平化（`object-paths`），前端消费的是同一份实现。**

实测（`git grep -n "from '@walnut/utils"`）：**全仓只剩 7 处 import / 6 个文件**：

```
apps/server/libs/guards/src/guards/sign.guard.ts:17      buildSignRaw, splitPathAndQuery, stripApiPrefix
apps/server/libs/guards/src/guards/security.guard.ts:11  stripApiPrefix
apps/server/libs/utils/src/general.ts:4                  objectToPaths（re-export）
apps/server/libs/utils/src/general.spec.ts:1             objectToPaths（对拍）
apps/admin/src/store/modules/app/app-security.ts:10      buildSignRaw, splitPathAndQuery
packages/platform-web/client/src/browser/shared.ts:9     objectToPaths（re-export）
packages/platform-web/client/src/browser/shared.test.ts:1 objectToPaths（对拍）
```

### 3.3 「server 那两处 import 仍然工作」的证据（不是推断，是跑出来的）

先重建 CJS 产物（`pnpm --filter @walnut/utils build`：`dist/index.cjs` + `dist/sign-raw.cjs` +
`dist/object-paths.cjs`），再在 `apps/server` 下直接 require：

```
node -e "require('@walnut/utils/sign-raw'); require('@walnut/utils/object-paths')"
sign-raw keys: buildSignRaw,splitPathAndQuery,stripApiPrefix
object-paths keys: objectToPaths,pathsToObject
objectToPaths({a:{b:1}}) -> {"a.b":1}
```

另有端到端证据：`pnpm -C apps/server openapi:export` **跑通了整个 AppModule 引导**
（Nest 启动 → Redis 连接 → 写 openapi.json，见 §4.4 的日志片段）—— 那条路径上就会加载两个 guard，
依赖解析失败的话会直接 `Cannot find module`。

### 3.4 包侧的连锁改动

- `utils-core/package.json`：`dependencies` 清空（原 `@walnut/contract` / `@walnut/types` / `js-base64`
  全部随实现搬到 client）；description 改成上面那句「双端消费面」
- `utils-core/vite.config.ts`：构建条目从 9 个收到 3 个（`index` / `object-paths` / `sign-raw`），
  并删掉 `external: ['js-base64']`（已经没有第三方依赖可外置）
- `utils-core/src/index.ts`：桶内容同步收缩到两件事，文件头写清判据
- `client/package.json`：**新增** `@walnut/contract`（`browser/crypto/const.ts` 从 `AES_GCM_WIRE` 派生常量）
- `client/README.md`：目录表加 `queue.ts` / `regex.ts`（并写明「别因为它们看起来像纯函数又上提回 platform-any」）、
  `browser/crypto` 与 `persistent/enhance` 的说明补上来源、边界段改成 D7 的判据
- admin 侧机械替换 **15 个文件**：`@walnut/utils/{queue,regex,crypto/transformer}` ->
  `@walnut/client/{queue,regex,browser/crypto/transformer}`（同一批文件里有 2 处 import 顺序被
  ESLint 判红，已用 `eslint --fix` 修好，只动了这两个 import 的位置）
- 文档同步：`utils-core/README.md` 重写导出面与「双端消费面」一节、`platform-any/types/README.md`、
  `monorepo/{architecture,glossary,release,turbo,typescript,pnpm-workspace-config,knip,turbo-cache-boundary}.md`、
  `plans/{modernization-roadmap,package-sinking-proposal}.md`、`review/backend/{api-catalog,api-docs-findings}.md`、根 `AGENTS.md` / `README.md` / `TODO.md`

### 3.5 验证

```
pnpm --filter @walnut/utils  build        -> exit 0（dist: index.cjs / sign-raw.cjs / object-paths.cjs）
pnpm --filter @walnut/utils  types:check  -> exit 0
pnpm --filter @walnut/client types:check  -> exit 0
pnpm --filter @walnut/client test         -> exit 0（6 文件 / 32 用例，含搬来的 5 个）
```

## 4. D9 · `api-types` 归位 + `openapi:check` 拆两段

### 4.1 归位

- `git mv packages/platform-web/api-types packages/generated/api-types`（125 个文件里的 3 个真实文件 + 生成物；
  包名 `@walnut/api-types` 不变）
- `pnpm-workspace.yaml`：新增 `packages/generated/*`（并在旁边写清为什么生成物要单独一组）
- `packages/generated/api-types/turbo.json`：tags 从 `["shared","platform-web"]` 改为 `["shared","generated"]`
- 根 `turbo.json`：新增 `boundaries.tags.generated`（deny `app` + `backend`，理由写在注释里：生成物
  反过来依赖 app 会让生成链成环；被后端依赖会让「DTO 改 → 重导 → 生成物变 → 后端类型变」自指）
- `versioning.fixed` 组**不需要改**（包名没变，`versioning-config.test.ts` 全绿）
- 发版归属**不需要改表**：`SCOPE_TO_PACKAGE` 里本来就没有 api-types，归属走**路径优先**；
  `attribution.ts` 的 `WORKSPACE_DIR_SHAPE`（`packages/<group>/<pkg>`）也已覆盖新路径

### 4.2 「78 个 import 点」的实际处理

实测 **79 处 / 79 个文件**（`apps/admin/src` 78 + `apps/admin/types` 1），而且**全部是裸包名**
`from '@walnut/api-types'`，没有一个走子路径 —— 所以搬迁**不需要改任何 import 点**（这正是保留桶的收益）。
改的只有路径本身：`apps/server/package.json` 的 diff 目标、prepush 的暂存区比对、release 电池注释、CI。
重建后 `pnpm openapi:check:schema` 对 `schema.d.ts` **零 diff**，等于逐字节证明了搬迁没有改变产物。

### 4.3 `openapi:check` 两段

`apps/server/package.json`：

```jsonc
"openapi:check:export": "pnpm openapi:export && git diff --exit-code -- openapi.json",
"openapi:check:schema": "pnpm openapi:generate && git diff --exit-code -- ../../packages/generated/api-types/src/schema.d.ts",
"openapi:check":        "pnpm openapi:check:export && pnpm openapi:check:schema"
```

根 `package.json` 同步加 `openapi:check:export` / `openapi:check:schema` 两个转发脚本
（CI 只能引用**根脚本名**，`gate-wiring.test.ts` 会解析 `pnpm <script>` 形态并核对；
写成 `pnpm -C apps/server …` 会被它读成脚本名 `apps`）。

### 4.4 段② 在「没有 ENV_KEYS」时也硬失败（本次的验收点）

实测段②不需要环境、不需要数据库：

```
pnpm openapi:check:schema
  $ openapi-typescript ../../../apps/server/openapi.json -o ./src/schema.d.ts
  openapi.json -> ./src/schema.d.ts [349.6ms]
  exit 0（零 diff）
```

CI（`.github/workflows/ci.yml` 的 openapi job）现在有互补的两步：

| step | if | 跑什么 |
|---|---|---|
| `OpenAPI schema drift check (segment ② — no secrets needed)` | `env.DOTENVX_KEYS == ''` | `pnpm openapi:check:schema`（**fork PR 也会红**） |
| `OpenAPI drift check (segment ① + ②)` | `env.DOTENVX_KEYS != ''` | `pnpm openapi:check` |

并同步改掉了那条「跳过 OpenAPI 一致性校验」的 note（它现在只说「段① 跳过」），
`prepush.ts` 里 F-53 边界② 的登记也从「未修」改成「已修」并写明做法。

段① 的实测（`pnpm -C apps/server openapi:export`）：

```
[NestApplication] Nest application successfully started
[AppTechRedisService] Redis client connected.
[export-openapi] written apps/server/openapi.json (openapi 3.0.0, 202 schemas)
```

### 4.5 「归位后没有残留」的证据

```
git grep -n "platform-web/api-types"   -> 只剩冻结语料（industry-research）与 reports/
pnpm lint:exports   -> exit 0（packages/generated/api-types 的 exports 目标都存在）
pnpm lint:docs-refs -> exit 0（331 篇活文档，0 死路径）
pnpm lint:turbo-cache -> exit 0（15 个包 / 91 个 task；新 tag `generated` 有包声明它）
```

## 5. D20 · TinyMCE 移出后端

### 5.1 搬迁

```
apps/server/apps/api/src/public/js/tinymce  ->  apps/admin/public/vendor/tinymce
125 个文件 / 4.08 MB（4,278,115 字节），git 识别为 125 个 rename
```

（`git mv` 在这个目录上被 Windows 拒了一次 —— `Permission denied`，逐文件 rename 却是允许的；
于是先整树 `Copy-Item`、用 SHA-256 逐文件比对 125 个文件完全一致，再删源目录，git 仍按 rename 记录。）

- `apps/admin/src/components/Vendor/Tinymce/index.vue:91`：脚本地址从
  `` `${httpUrl}/static/js/tinymce/tinymce.min.js` ``（后端静态目录）改为 `'/vendor/tinymce/tinymce.min.js'`，
  与 `public/vendor/codeMirror` 的约定一致；顺带删掉不再需要的 `useAppEnvProxy` 导入
- 后端不再分发它：`apps/server/apps/api/src/public/js/` 现在只剩 `cap/` 与 `oauth-close.js`

### 5.2 连锁面（逐项核过）

| 面 | 结论 |
|---|---|
| `apps/server/infra/scripts/verify-build-assets.ts` | **不需要改**：`REQUIRED_ASSETS` 只有 `favicon.ico` / `demo.png` / i18n / 邮件模板，tinymce 从来不在其中（所以它的移动本来就没有断言守着） |
| 镜像体积断言 | **不存在**（`git grep -il 'size-limit\|镜像体积\|image size'` 在 `.github` / `deploy` / `docker-bake.hcl` 上 0 命中）—— 这条「若有的同步」事实上是空的，登记在 §6.3 |
| nest-cli 资产拷贝 | `public/**/*` 的 include 不变，目录少了就是少拷，不需要改配置 |
| 前端镜像 | `apps/admin/Dockerfile` 只 `COPY html/`（= `apps/admin/dist`），Vite 的 `publicDir` 会把 `public/vendor/tinymce` 原样带进去；`public/vendor` 在 `frontend-server.conf` 里是**稳定名、刻意不给长缓存**的那一档，与新的用法一致 |
| ESLint | **必须改**：搬进来之后 `pnpm --filter @walnut/admin build` 在 plugin-checker 的 ESLint 阶段炸了 **73,968** 条 `style/*`（`plugins/emoticons/js/emojis.js` 单个 33,299 条）。已在 `apps/admin/eslint.config.ts` 加 `ignores: ['public/vendor/**']` 并写清理由（第三方产物、改一行就会被下次升级覆盖）；只忽略 vendor，`public/` 下自有资产照旧受检 |

## 6. 门禁实测

### 6.1 绿的门禁（本次直接相关）

| 命令 | 退出码 | 关键输出 |
|---|---|---|
| `pnpm boundaries` | 0 | `Checked 4544 files in 15 packages, no issues found` |
| `pnpm lint:exports` | 0 | 11 个声明 exports 的包全部成立 |
| `pnpm lint:turbo-cache` | 0 | 91 个 task / 15 个包 |
| `pnpm lint:docs-refs` | 0 | 331 篇活文档，0 失效 |
| `pnpm lint:adr` | 0 | 27 篇 ADR，形态与 index 对齐 |
| `pnpm lint:doc-ts` | 0 | 124 个 ts 块 + 3 个 json 块 |
| `pnpm lint:doc-budget` | 0 | 6 个常驻文件都在预算内（AGENTS.md 95%） |
| `pnpm lint:emoji` | 0 | 1209 个文本文件 |
| `pnpm lint:lockfile` | 0 | catalog 与锁文件锁步 |
| `pnpm lint:workflows` | 0（**跳过**） | 本机没有 actionlint ⇒ 只做了 YAML 解析校验（`yaml` 包解析成功，jobs = quality/build/openapi，openapi 的两个新 step 的 `if` 互补）。CI 侧仍会硬跑 actionlint |
| `pnpm --filter @walnut/scripts test` | 0 | 31 文件 / 512 用例（含 prepush / gate-wiring / doc-refs） |
| `pnpm --filter @walnut/release test` | 0 | 12 文件 / 202 用例（含 versioning-config / attribution / steps） |
| `pnpm --filter @walnut/utils {build,types:check}` | 0 / 0 | dist 3 个条目 |
| `pnpm --filter @walnut/client {types:check,test}` | 0 / 0 | 6 文件 / 32 用例 |
| `pnpm openapi:check:schema`（段②） | 0 | `schema.d.ts` 零 diff |

### 6.2 仓级三条（最终全绿）与期间的归属账

| 命令 | 最终退出码 | 最终输出 |
|---|---|---|
| `pnpm lint` | 0 | `Tasks: 15 successful, 15 total`（server 2 条 warning、0 error） |
| `pnpm types:check` | 0 | `15 successful, 15 total` |
| `pnpm --filter @walnut/admin build` | 0 | `✓ built in 2m 59s`，`dist/vendor/tinymce/**` 与预压缩 `.br/.gz` 都在 |

期间出现过三轮红，账要留清（否则下次复现会以为是「本来就有」）：

1. **开工时**（我还没改任何文件）就已经红：`pnpm types:check` 报 `@walnut/server` 8 条
   `params.query does not exist`（`libs/{app-domain,system}` 5 个文件 + `locale.service.ts`），
   `pnpm lint` 报 admin 的 `ApiSelect/index.vue` 与 `columns.tsx` 的 `sort-imports`。
   归因：`b4-r2-wire` 的在途 list-wire 改动（`query` -> `filters`）。它改完后 types:check 自动转绿。
2. **D20 的副产物**：tinymce 搬进 `apps/admin/public/` 后 `pnpm --filter @walnut/admin build` 炸出
   **73,968 条** `style/*`（`plugins/emoticons/js/emojis.js` 单文件 33,299 条）。
   这是**我的**责任，修法见 §5.2（`ignores: ['public/vendor/**']`）。
3. **我的 3 条**：client 里 3 个文件因为把绝对导入改成相对导入，`sort-imports` 判红
   （`api-sign-key.ts` / `aes-gcm.ts` / `persistent/enhance/index.ts`），`eslint --fix` 修好。

> 另有 2 个**不属于我改动面**的文件被我用 `eslint --fix` 碰过一次（只为让 build 转绿）：
> `apps/admin/src/components/Advanced/ApiSelect/index.vue`、
> `apps/admin/src/components/UI/Table/src/hooks/useTableColumns.tsx` —— 各只重排了一行 import，
> 没有改任何语义。如果 `b4-r2-wire` 合并时发现这两处被覆盖，重跑一次 `eslint --fix` 即可。

### 6.3 一处**看起来像问题、实际不是**

`apps/server/openapi.json` 与 `packages/generated/api-types/src/schema.d.ts` 在工作区里是「已重新生成」
状态：我跑段①/段② 验证时，另一个 agent 的 DTO 改动（`query` -> `filters`）已经在代码里，
于是重导出的 openapi.json 有 2354 行 diff、schema.d.ts 同步变成含 `FilterDTO` 的版本。
为了不让「半套生成物」留在工作区，我把两者都重跑成**同一份 openapi.json 的产物**，并做了幂等验证：

```
schema.d.ts 连续生成两次 -> hash 相同
openapi.json 连续导出两次 -> hash 相同（202 schemas / 173 paths）
```

这两个文件的最终归属是 `b4-r2-wire`（它的任务里就写着「openapi/schema 重生成」），提交时请一起带上。

## 7. 需要 Lead 拍板

1. **ADR 0013 的判据措辞**：任务要求写「桶取决于**本仓之外**的消费者」，但本仓现在**没有**任何
   有仓外消费者的包（全 private），照字面执行会把 `api-types`（79 个文件的唯一入口）判死 ——
   而那正是任务要求保留的。我落地的写法是「先问仓外，没有则数仓内裸包名站点」两层判据，
   并在 ADR 里用 2026-11 审计表把两端都钉住。请确认这个措辞可以接受。
2. **`@walnut/utils` 与 `@walnut/types` 的桶**：两者裸包名站点都是 **0**（utils 30 导出 / 7 处子路径，
   types 15 导出 / 39 处子路径）。按新判据它们都是「下一个候选」，但都不在 D8 的三桶清单里，
   **我没有删**。要不要在下一批按同一判据一起删？（删了 `@walnut/types` 的桶等于只留子路径，
   它 39 个消费文件全部已经是子路径，风险极低。）
3. **`openapi:check` 的两段是否也要进发版电池的分裂**：现在发版电池只有一段 `openapi:check`
   （两者都跑），fork PR 的段② 只在 CI 生效。如果希望「贡献者本地也能只跑段②」，
   可以再加一段 prepush 的 `openapi:schema`（无环境依赖、秒级）—— 我没加，因为它会让
   prepush 同一结论出现两条来源。
4. **TinyMCE 的 npm 依赖要不要同时去掉**：`apps/admin/package.json` 仍声明 `tinymce`（8.5.0）
   与 `@tinymce/tinymce-vue`。前者现在只被 `Tinymce/index.vue` 当**类型**用（`RawEditorOptions`），
   运行时代码来自 `public/vendor/tinymce` 的 vendored 副本 —— 也就是说仓里有**两份 tinymce**
   （git 里 4.08MB + node_modules 一份）。要不要把 vendored 副本改成构建期从 node_modules 拷贝？
   那会牵动「public 下的稳定名文件」这条缓存约定，我没有擅自做。
5. **§6.2 里我替 `b4-r2-wire` 改的那 2 个文件**：`ApiSelect/index.vue` 与 `useTableColumns.tsx`
   各只重排了一行 import（零语义）。要保留还是 `git checkout` 回去（会重新红 2 条 `sort-imports`），请拍板。

## 8. 过程中发现的、与本次改动无关的两个真问题

### 8.1 `exports-glob-matches` 的 `*` 语义与 Node 不一致（门禁假红风险）

`packages/tooling/scripts/src/ci/check-package-exports.ts` 复用了 `globMatchesSomething()`，
而后者把 `*` 当**单段通配**（`[^/]*`）；但 Node 的 `exports` 子路径模式里 `*` **可以跨 `/`**
（`@walnut/client/browser/cookie` 就是靠 `./*` -> `./src/*.ts` 解析的）。

删掉 client 的桶时这条不变量**确实红了一次**：

```
[exports-glob-matches] @walnut/client exports["./*"] -> `./src/*.ts` 一个文件都没命中
```

原因是那时 `client/src/` 根下一共只有一个 `.ts` 文件 —— 就是我刚删掉的 `src/index.ts`。
D7 把 `queue.ts` / `regex.ts` 放到 `src/` 根之后它自己变绿了（所以现在的绿**部分是巧合**：
哪天这两个文件挪进子目录，门禁会在解析完全正常的情况下再红一次）。

建议（未动手，属 tooling 面）：让 exports 的**模式**匹配用「`*` 跨段」的语义（与 Node 对齐）
并补一条单测 —— 现在的实现是「文件 glob」与「包解析模式」共用一套语义，这本身就是错的。

### 8.2 「75 导出」与实测对不上

决策写 75，实测 client 54 + http 15 = **69**（若含 utils 的 30 则是 99）。
三种口径我都记在这里，供 R3 复核时对账；裁决本身不受影响（0 消费是硬的）。

## 9. 未做 / 明确留给别人

- 没有 commit（按要求）
- 没有动 `packages/platform-any/contract/src/pagination.ts`、`apps/server/libs/{list,repository}`、
  `apps/admin/src/hooks/web/useTableAPIListParams.ts`、21 个 controller、16 个 .vue
- 「碰到并行 agent 的文件」有两处，都已登记：
  1. `packages/platform-web/http/src/index.ts`（我删的桶）在删除前被它加了 3 个类型 re-export
     （`BaseFilterParams` / `FilterParam` / `FilterOp`）。这些类型住在 `types.ts`、经
     `@walnut/http/types` 子路径可达，所以删桶没有丢任何能力；但**它若从桶里 import 会
     `Cannot find module`** —— 已在给 Lead 的消息里点名，需要它改成子路径。
  2. §6.2 末段那两个 admin 文件（`eslint --fix` 只重排 import）。
