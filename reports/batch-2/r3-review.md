# 批次 2（门禁可信化）· R3 复查轮实测报告

> 复查对象：R2 提交 `c8d72591`（四件：turbo `platform-web.deny`、knip 5 包 `project` + `includeEntryExports`、madge 进 prepush、`walnut-scaffold-lib`）。
> 本轮**只读**，不修一行源码；所有结论都来自本轮自己重跑，不引用 R2 的输出。唯一写入本文件。
> 环境：HEAD `0e152d36`（R2 提交在其前 6 个 commit）、Windows/pwsh、命令一律 `cmd /c "pnpm ..."`。

---

## 0. 三条前置事实（会直接影响你怎么读后面的数字）

| 项 | 任务书 | 实测 |
|----|--------|------|
| HEAD | `0e152d36` | **一致**（`git rev-parse --short HEAD` 输出 `0e152d36`） |
| 工作树 | clean | **起步 clean，会话中途被并发同伴改脏**：`apps/server/libs/{cache,cookie,guards,security}/**`、`apps/server/apps/api/test/**`、`apps/admin/src/utils/axios/**`、`apps/docs/**`，另有 `reports/batch-3/`。**没有一处是本轮探针**（§7 有逐条还原证据） |
| lockfile | 跑脚本会被改写 | `git status --porcelain -- pnpm-lock.yaml` 全程**为空** |

**两条命令口径（影响可复现性，建议写进下一轮任务书）**：

1. **负对照不要用 `pnpm <script>` 注入后再跑**（改 `apps/admin/package.json` 后 pnpm 会认为依赖图不一致而自动 install）。边界探针一律直调 `node_modules\.bin\turbo.cmd boundaries`。
2. **工具层会把任何非零退出码折叠成 1**（实测 `node -e "process.exitCode = 2"` 也被报成 exit 1）。要拿真实退出码必须读 `$LASTEXITCODE`。本报告里凡写「exit 2」都是这样测出来的。

---

## 1. 负对照复现（三条，全部实测 + 已还原）

### 1.A 前端 import 一个 `@walnut/server` → boundaries 红 ✅

注入（`apps/admin/package.json` 的 `dependencies` 首行插 `"@walnut/server": "workspace:*"`）后：

```
$ node_modules\.bin\turbo.cmd boundaries
Checking packages...
Checked 4658 files in 15 packages, 1 issue found        ← exit 1

  x Package `@walnut/server` found with tag listed in denylist for `@walnut/admin`: `platform-node`
   ,-[apps\server\turbo.json:3:30]
   3 |   "tags": ["app", "backend", "platform-node"]
  `->   x denylist defined here
          ,-[turbo.json:63:19]
       63 |           "deny": ["platform-node"]
```

判定：**门禁生效，报错直接指到规则出处 `turbo.json:63`**。还原（`git checkout -- apps/admin/package.json`）后重跑 → `Checked 4658 files in 15 packages, no issues found`，exit 0；`pnpm-lock.yaml` 未变。

> 基线口径：净树自报 **4658 files**（R2 记 4656，差异来自其后 6 个 commit 的增删）。

### 1.B barrel 加一个 0 引用导出 → knip 报不报？**一个包不报** ✅

一次挂 6 个探针（各追加一行 `export const __R3_* = 1`，跑一次 `knip --reporter json`，按符号名精确检索）：

| # | 探针位置 | 类型 | knip 是否报出 |
|---|----------|------|---------------|
| B1 | `packages/platform-web/client/src/index.ts` | barrel | **报**（`index.ts:87:14`） |
| B2 | `packages/platform-any/utils-core/src/index.ts` | barrel | **报**（`index.ts:40:14`） |
| B3 | `packages/platform-web/http/src/index.ts` | barrel | **报**（`index.ts:26:14`） |
| B4 | **`packages/platform-any/contract/src/index.ts`** | barrel | **不报** ← 盲区 |
| B5 | `packages/platform-web/client/src/browser/cookie.ts`（深层） | 非 barrel | 报（`cookie.ts:53:14`） |
| B6 | `packages/platform-any/contract/src/role.ts`（深层） | 非 barrel | 报（`role.ts:26:14`） |

只剩 1 个没报：`__R3_BARREL_CONTRACT`。

**盲区就在 `@walnut/contract` 一个包**，不是「barrel 一律看不见」。R2 的措辞（部分盲区、因包而异、原因未查清）方向对；本轮把范围收敛到确切的一个包，并给出一个可检验的**相关性**（不是结论）：

- contract 是 5 个包里**唯一** `exports["."]` 写成条件对象、且把 `require` / `default` 指向不存在的 `./dist/index.cjs` 的（`packages/platform-any/contract/package.json:7-22`，另有 `:23-25` 的 `main` 指向同一 dist）；其余三包 `"."` 都是裸字符串 `"./src/index.ts"`（例 `packages/platform-web/client/package.json:7-11`）。
- 也就是说 knip 很可能把 contract 的 `src/index.ts` 当成「构建产物源」而不是「包入口」，于是它的导出天然算「被用」。**这条未验证**，但它是唯一能解释三者行为差异的结构性差别。

### 1.C lib 里一条向上层 import → ESLint 红 ✅

注入：`apps/server/libs/cache/src/token-ttl.port.ts`（tech-base）首行加 `import { ScopeResolverService } from '@walnut-server/scope-resolver'`（tech-assemble）。

```
$ cd apps/server; node_modules\.bin\eslint.cmd libs/cache/src/token-ttl.port.ts
  1:1  error  '@walnut-server/scope-resolver' import is restricted from being used by a pattern.
              lib 分层门禁：技术设施层 不能 import repository / list / crud / scope-resolver / token / …
              依赖方向见 ADR 0022。  no-restricted-imports
  1:10 error  'ScopeResolverService' is defined but never used   unused-imports/no-unused-imports
✖ 3 problems (3 errors, 0 warnings)                            ← exit 1（85.4s）
```

判定：**分层门禁有效，消息自带「为什么」与 ADR 编号**。还原后该路径 `git status` 为空。

> 两个必须记的观察：① 单文件 eslint 用了 **85.4s**（几乎全耗在加载 flat config / nest 预设，与文件数无关）——这是 `prepush` 里 `lint` 段 2m36s 的成本来源；② 我的注入方式引入了 BOM，被 `unicode-bom` 抓到（探针副作用，不是仓库问题），顺带说明这条规则也是活的。

---

## 2. knip 的代价评估：+114 条，**87% 在 3 个 barrel 上说同一件事**

### 2.1 先把数字钉死（同一棵树上做 A/B，不跨快照比）

用 `git restore --source=c8d72591^ --worktree knip.config.ts` 把配置退回 R2 之前，同一棵树各跑一次 `knip --reporter json`：

| | Unused files | Unused exports | Unused types | 合计 | packages/** | apps/** |
|---|---|---|---|---|---|---|
| 改前（R2 前配置） | 16 | 51 | 24 | **91** | **4** | 87 |
| 改后（HEAD 配置） | 16 | 140 | 49 | **205** | **118** | 87 |
| 差 | 0 | **+89** | **+25** | **+114** | +114 | **0** |

- **R2 的 +89 是对的**（导出净增 89，100% 落在 `packages/**`）；类型净增 25 ⇒ 合计 **+114** 而不是 +89。
- **R2 / R1 的一句结论是错的**：「改前 `packages/**` 一条发现都没有」。实测改前有 **4 条**，全在 `packages/tooling/eslint-config`（`comment-rules.ts` 3 条 + `script-rules.ts` 1 条）。这些文件自 2026-10-31 起未变、R2 提交也没动这个包（`git log c8d72591..HEAD -- packages/tooling/eslint-config/` 为空）⇒ 它们在 R2 之前就存在。
- 正确口径应是「**五个共享包**（contract / utils-core / types / client / http）此前不在分析面」，而不是「`packages/**` 整块」。这句话被写进了两处活文档，见 §6 的 D-1。

### 2.2 118 条 `packages/**` 发现按位置分布

| 落点 | 条数 | 占比 |
|------|------|------|
| `packages/platform-web/client/src/index.ts`（barrel） | **54** | |
| `packages/platform-any/utils-core/src/index.ts`（barrel） | **30** | |
| `packages/platform-web/http/src/index.ts`（barrel） | **15** | |
| 三个 barrel 小计 | **99** | **84%** |
| 深层文件合计 | 19 | 16% |
| 其中 `packages/tooling/eslint-config`（**改前就有**） | 4 | |
| 归属本轮 5 个包的合计 | **114** | |
| 5 包中在 barrel 的 | 99 | **87%** |
| 5 包中在深层文件的 | 15 | 13% |

深层那 15 条：`http/src/types.ts` 5（types）、`client/browser/shared.ts` 3、`client/browser/cookie.ts` 2、`crypto/shared.ts` 1、`file/download.ts` 1、`hooks/vueuse/useDraggableElement.ts` 1、`store/createWalnutStore.ts` 1、`utils-core/src/crypto/const.ts` 1（type）。

### 2.3 关键事实：**能报的 3 个包入口根本没人用，唯一有入口消费的包恰好报不出来**

全仓统计 import 语句的来源说明符（3502 个被跟踪文本文件，含 .vue / .tsx / .md）：

| 说明符 | 语句数 |
|--------|--------|
| `@walnut/client`（入口） | **0** |
| `@walnut/http`（入口） | **0** |
| `@walnut/utils`（入口） | **0** |
| `@walnut/types`（入口） | **0** |
| `@walnut/contract`（入口） | **230** |
| `@walnut/client/*`（深路径） | 115 |
| `@walnut/contract/*` | 154 |
| `@walnut/utils/*` | 35 |
| `@walnut/http/*` | 10 |

三件事连起来看：

1. **99 条 barrel 发现 = 「这三个包的入口 src/index.ts 全仓 0 消费」这一件事被拆成 99 行**。消费方（如 `apps/admin/src/utils/persistent/Cookie.ts:2`）走的是**深路径** `@walnut/client/browser/cookie`，不是入口。
2. 这 99 个符号里 **89 个经深路径被真实消费**（逐个按符号名匹配 import 语句得出）——它们**不是死代码**，只是「入口那一层没人走」。
3. **唯一入口有 230 处消费的 `@walnut/contract`，恰恰是 §1.B 那个报不出来的包。** 两个集合**没有交集** ——这是本轮关于 knip 最重要的结构性发现：**它报得出来的地方没有真问题，有真问题的地方它报不出来。**

### 2.4 所以：真死多少、公共面多少、代表性样本

| 类别 | 条数 | 说明 | 样本 |
|------|------|------|------|
| **真死（任何说明符都没人 import、本源文件外 0 引用）** | **3**（约 3%） | 只有这几条是「删了不会有人疼」 | `client/src/browser/crypto/shared.ts:34` `importKeyFromPEM` · `tooling/eslint-config/comment-rules.ts:142` `EMOJI` · `tooling/eslint-config/script-rules.ts:165` `DEFAULT_ALLOWED` |
| **barrel 公共面（`exports["."]` 声明的对外 API）** | **99**（84%） | 语义上「对外公共面」成立，但**本仓入口消费 = 0** | `useState` / `useProps` / `isInSetup`（client barrel）· `objectToPaths` / `buildSignRaw` / `SingletonPromise`（utils-core barrel）· `removeCurrentPageRequests` / `Axios` / `WalnutAdminConstAppResponseCode`（http barrel） |
| **深层导出但经深路径被消费** | 10 | 报了但实际在用（「入口 vs 深路径」两套 API 面并存） | `client/browser/cookie.ts` 的 `Cookie` / `removeCookie`（admin 从 `@walnut/client/browser/cookie` 引）· `http/src/types.ts` 的 `SortOrder` / `BasePageParams`（`@walnut/contract` 引） |
| **预存噪音（非本轮 5 包）** | 4 | 改前就有，含 1 条形如 `export default` 的天然不可判条目 | `tooling/eslint-config/comment-rules.ts:141` `default` |

**一句话回答「更有用还是更吵」**：**信息量增加了，但它报的不是你以为的那个问题。** 它补上了「`packages/**` 深层文件从未被分析」这件真事（15 条深层发现里 3 条真死、10 条说明 API 面割裂），但新噪音的 **87%（99/114）在重复同一句结构性结论**，而唯一有真实入口消费的包仍在盲区。**按现状它更吵，而且吵的方式会让人误读成「一堆死代码」。**

### 2.5 可执行的降噪建议（按性价比）

| # | 动作 | 效果 | 代价 |
|---|------|------|------|
| **N1** | **先定 barrel 的命运**（87% 噪音的根因）：要么把 160 处深路径 import（client 115 + utils 35 + http 10）收敛到包入口，要么删掉 3 个 `src/index.ts` 与 `exports["."]` | 噪音 −99 行，并顺带修掉一个真实的 API 面割裂（同一函数两套可达路径） | 改 160 处 import 或删对外 API，超出本批范围 |
| **N2** | 短期不动根因：给 3 个 barrel 文件加 `ignoreIssues`（**按文件，不要按符号**——54 个符号名会变成新的腐化清单） | 114 → **15**（−87%），剩下的正是深层那批真信号 | 「入口 0 消费」这条结论只能靠文档/待办记住 |
| **N3** | **不要把 knip 接进 prepush / CI / 发版电池**（现状即如此，保持） | — | 若非要接，只接 `knip:packages`，且先做完 N1 或 N2 |
| **N4** | 给 `contract` 立一个「barrel 符号 0 引用」专用脚本（读 `src/index.ts` 具名导出 → 全仓 grep 消费方） | 补上 knip 覆盖不到、而它恰是唯一有真实入口消费的包 | 约半天 |
| **N5** | 把「改前 `packages/**` 有 4 条」修回文档与配置注释 | 见 §6 D-1 | 5 分钟 |

---

## 3. madge 段：真的会跑，造环真的会红 ✅（20.1s）

不是「看表里登记了」，而是**用 prepush 的真执行器跑了一遍**：`import { PREPUSH_GATES, runGates }` 后只筛 `id === 'circular'` 交给 `runGates`（同一个并行器、同一个 `runArgs`、同一个 cwd）。

| 场景 | 实测输出 | 结论 |
|------|----------|------|
| 净树 | `done circular OK 20076ms`；`$ pnpm -C apps/server madge` → `$ madge --circular --ts-config tsconfig.json apps/api/src libs --extensions js,ts,tsx` → `Processed 1060 files (17.9s) (18 warnings)` → `√ No circular dependency found!` | **真的会跑**，整条转发链（根 `madge:check` → server `madge`）完整 |
| 造环（`apps/server/libs/utils/src/r3-cycle-a.ts` 与 `r3-cycle-b.ts` 互相 import） | `done circular FAIL 10020ms` → `× Found 1 circular dependency!` / `1) libs/utils/src/r3-cycle-a.ts > libs/utils/src/r3-cycle-b.ts` / `[ELIFECYCLE] Command failed with exit code 1.` | **造环会红**，报出精确链路；`runGates` 返回 `ok=false` ⇒ `main()` 抛 `ViolationError` ⇒ 整次 push 被拦 |
| 删掉探针后 | `git status --porcelain -- apps/server/libs/utils` **为空** | 已还原 |

- **耗时 20.1s**（R1 记 10.3s、R2 记 10–21s；本轮更高是因为并发同伴在跑门禁 + 文件数涨到 1060）。放在 `DEFAULT_CONCURRENCY = 4` 的表里，与 `lint`（2m36s）/ `types`（35s）并行**不构成瓶颈**，但它占一个并发槽约 20s。
- **接线完整**：prepush `prepush.ts:75-83`（第 2 段）· 根脚本 `package.json:58` · CI `ci.yml:70-71` · 发版电池 `steps.ts:66`。
- **但它把发版电池的测试打红了**，见 §5.3 —— 本轮最严重的发现。

---

## 4. 脚手架：幂等 ✅ / drift spec ✅ / 只改对的那个分层数组 ✅（但它**确实**改 ESLint 名单）

用 `node packages/tooling/scripts/bin/scaffold-lib.ts r3-probe-lib --layer=tech-base`（本机 shim 未装，按任务书直调 bin）。

| 步 | 实测 | 判定 |
|----|------|------|
| `--dry-run` | `注册面共 14 个文件，待改 14 个`，逐行列改动，`git status` 无变化 | 试跑不落盘 ✅ |
| 真跑 | `✅ 已写入 14 个文件`（12 改 + 2 新建：`libs/r3-probe-lib/{tsconfig.lib.json,src/index.ts}`） | ✅ |
| **幂等** | 第二次：`注册面共 14 个文件，待改 0 个` / `已经是最终态（零改动）—— 幂等，未写任何文件` | ✅ |
| **drift spec** | `lib-registration.drift.spec.ts` → `Test Files 1 passed / Tests 9 passed (9)` | ✅ 注册面真的齐了 |
| **拒绝层 fail-closed** | `--layer=identity` → `$LASTEXITCODE=2`，报错带「手工改哪三处」+ 可自动登记的五层清单；`--layer=bogus` / 缺 `--layer` / 非法名 同为 **2** | ✅ 与 `lib/cli.ts:49-53` 的「PreconditionError → 2」一致 |
| 还原 | 12 个注册面 `git diff --stat` **为空**；`libs/r3-probe-lib` 移出仓库到 `%TEMP%\r3-probe-lib-backup` | ✅ |

### 4.1 「不会误改 ESLint 分层名单」——准确说法是「会改，但只改对的那一个数组」

```diff
- const TECH_BASE_LIBS = ['als', 'blpath', 'cookie', 'crypto', 'delay', 'lock', 'queue', 'sse', 'cache', 'throttle', 'mailer', 'sms', 'rsa', 'ip'] as const
+ const TECH_BASE_LIBS = ['als', 'blpath', 'cookie', 'crypto', 'delay', 'lock', 'queue', 'sse', 'cache', 'throttle', 'mailer', 'sms', 'rsa', 'ip', 'r3-probe-lib'] as const
```

`apps/server/eslint.config.ts:20` 一行 append，**没有重排、没有碰其它 5 个数组**；drift spec 的 `LAYER_MATRIX` 的 tech-base 行同样只 append 一项（两处 `git diff` 均 +1/−1）。

所以：

- **「名单仍手写」成立** —— 脚手架是**往字面量里插一个字符串**，不是生成名单（R2 的口径没错）；
- 但**「不会改 ESLint 名单」不成立** —— 它一定会改，且**必须改**（不改就 `layer libs 并集 ≠ 矩阵` 立刻红）。验收该问的是「改对没有」，答案：改对了，`--layer` 与目标数组一一对应，其它层零触碰。
- 建议：这条语义写进脚手架 `USAGE`（`src/scaffold/scaffold-lib.ts:21-28`）——现在只说「可自动登记：infra | …」，没说「会改这两处字面量名单」。

---

## 5. 联动：一处**真的坏了**

### 5.1 `lint:turbo-cache` 的反向断言**仍然活着** ✅

| 场景 | 实测 |
|------|------|
| 净树 | `✅ Turborepo 配置不变量：91 个 task、15 个包，全部成立`（exit 0） |
| **负对照**：给 `boundaries.tags` 加一个没有任何包声明的 `phantom-tag-r3` | **`$LASTEXITCODE=1`** |
| 还原后 | 回到 exit 0 |

负对照命中的正是 `packages/tooling/scripts/src/ci/check-turbo-cache.ts:369-375` 那条 `boundary-rule-has-subject`（「这条规则永远不会生效（恒关的规则 = 没有规则）」）。所以 R2 的 `platform-web.deny` **不是恒关规则**：`platform-web` 由 `apps/admin` + `packages/platform-web/{api-types,client,http}` 四包声明，反向断言照旧成立。

### 5.2 fork PR 不会因新步骤红 ✅

- 新步骤 `ci.yml:70-71` **没有 `if:`、不读任何 secret、不使用 job 级 env**（对比同文件 `ci.yml:244-246` / `:268-272`：build job 把 `secrets.ENV_KEYS` 绑到 env 再用 `env.X != ''` 判断）。因此 fork PR 上**会照跑**。
- 它也不需要 env / PG / Redis：madge 只做 AST 解析；`madge` 是 `apps/server` 的 devDependency（`apps/server/package.json:165`），`pnpm install --frozen-lockfile` 后即可用。
- `lint:workflows-shell`：`4 个文件、73 段 shell 块，bash -n 全部通过`。
- **仍未消除的旧口径**：`pnpm lint:workflows` 本机 → `⚠ 未检测到 actionlint，跳过 workflow 校验（CI 中会强制执行）`。新增步骤的 YAML 只经过 YAML 解析 + shell 块语法，**没经过 actionlint**（R2 已记录，本轮仍未改变）。

### 5.3 ❌ 发版电池的两个机械审计用例**现在是红的**（R2 的「门禁全绿」不成立）

```
$ cd packages/tooling/release; node_modules\.bin\vitest.cmd run
 ❯ src/release/__tests__/steps.test.ts (13 tests | 2 failed) 44ms
     × 逐行钉住会跑的电池（顺序即执行顺序）
     × id 与顺序逐字等于 RELEASE_BATTERY（少一条 / 多一条 / 换位置都会红）
 Test Files  1 failed | 11 passed (12)
      Tests  2 failed | 200 passed (202)
```

**根因**：R2 在 `packages/tooling/release/src/release/steps.ts:66` 加了 `circular` 行，但两处**跟着它走的手写副本没同步**：

1. `packages/tooling/release/src/release/__tests__/steps.test.ts:35-37` —— argv 夹具仍是 `['hooks:check'], ['boundaries'], ['exec','turbo','run','lint'], …`，缺 `['madge:check']`（断言 expected 26 条 vs received 27 条）。
2. `apps/docs/src/zh-CN/content/monorepo/release.md:152-156` —— 电池表（表头在第 152 行）只有 `hooks` / `boundaries` / `lint`…，缺 `circular` 行；`steps.test.ts:179` 逐字对账 `release.md` 与 `RELEASE_BATTERY`（expected 27 个 id vs received 28 条）。

**为什么 R2 没发现**（比 bug 本身更重要）：

1. `prepush` 的 25 段里**没有 `test` 段**。实测 `PREPUSH_GATES` 的 id：`boundaries, circular, lint, lint-root, types, types-root, syncpack, workflows, workflows-shell, dynamic-imports, docs-refs, adr, doc-ts, doc-budget, emoji, seed, openapi, dts, turbo-cache, lockfile, nginx-headers, exports, secrets, pre-hooks, versioning`，`has test gate: false` ⇒ **这类红不可能被 push 拦住**。
2. R2 自检跑的是 `pnpm --filter @walnut/scripts test`（只覆盖 scripts 包），**漏了 release 包**。
3. 能拦住它的只剩 CI 的 `Tests (affected)`（`ci.yml:113-114`）或手动 `pnpm test`。

> 判据：这条红由 `c8d72591` 引入，到 HEAD `0e152d36`（其后 6 个 commit）**仍然存在**，本轮在 HEAD 上复现。

---

## 6. 其他发现（按严重度）

| # | 级别 | 发现 | 位置 |
|---|------|------|------|
| **D-1** | 中 | **「改前 `packages/**` 一条发现都没有」是错的**（实测 4 条，在 `packages/tooling/eslint-config`）。正确口径是「五个**共享包**此前不在分析面」 | `knip.config.ts:21`、`apps/docs/src/zh-CN/content/monorepo/knip.md:78`（`:40` 那句「共享包第一次真的进了分析面」是对的，不用改） |
| **D-2** | 中 | `knip.md:81` 写「+89 / +25，新增**全部**落在 `packages/**`」——数字对，但读者会以为总量只涨 89；实际 91 → 205（**+114**）。建议把 files/exports/types 三列都写全 | `knip.md:78-83` |
| **D-3** | 低 | 活文档里出现会腐烂的计数：`unused 50→139`、`madge 进 prepush（25 段）`。本仓自己的纪律就是「别写会腐烂的计数」，而 139 本轮已实测漂到 140 | `apps/docs/src/zh-CN/content/industry-research/backend-architecture-review/10-implementation-plan.md:277` |
| **D-4** | 低 | 脚手架 `USAGE` 没说明它会改两个**字面量名单**（eslint 分层 + drift 的 `LAYER_MATRIX`），读者容易以为只是加 JSON 键 | `packages/tooling/scripts/src/scaffold/scaffold-lib.ts:21-28` |
| **D-5** | 低（预存） | `prepush` 无 `test` 段：`pnpm prepush` 可以在 `pnpm test` 全红的情况下绿。R2 这次就是被这个缺口漏过去的 | `packages/tooling/scripts/src/ci/prepush.ts:68-242` |

---

## 7. 本轮做了什么 / 没做什么

**跑了**：`turbo boundaries`（基线 / 注入 / 还原）· `knip --reporter json`（8 次，含 R2 前配置的 A/B 与 6 探针）· `eslint <单文件>`（含注入）· `runGates([circular])`（净树 / 造环）· `scaffold-lib`（dry-run / 真跑 / 幂等 / 拒绝层 ×4）· `lib-registration.drift.spec.ts` · `lint:turbo-cache`（净树 / phantom tag / 还原）· scripts 包 3 个测试文件（23 passed）· release 包全量测试（**2 failed**）· `lint:workflows` / `lint:workflows-shell` / `lint:docs-refs`。

**没跑**（如实交代）：`pnpm prepush` 全表（25 段，含需 WSL PG/Redis 的 `openapi` 段，且会与并发同伴互相干扰）· `pnpm test` 全量（turbo，分钟级；release 包已单跑）· `pnpm lint`（2m36s，且并发同伴正在改 `apps/**`，跑出来的红无法归因）· actionlint（本机未安装）。

**还原证据**：§1.A / §1.B / §1.C / §3 / §4 各节都写了还原后的命令与输出；12 个注册面 `git diff --stat` 为空；6 个 knip 探针按原字节写回；`apps/server/libs/utils` 无残留；`pnpm-lock.yaml` 全程未变。

**关于最终 `git status` 不干净**：残留项全部是**并发同伴**的改动（`apps/server/libs/{cache,cookie,guards,security}/**`、`apps/server/apps/api/test/**`、`apps/admin/src/utils/axios/**`、`apps/docs/**`、`reports/batch-3/`），与本轮探针路径**零交集**（探针只用过：`apps/admin/package.json`、`turbo.json`、`packages` 下 6 个文件、`apps/server/libs/cache/src/token-ttl.port.ts`、`apps/server/libs/utils/src/r3-cycle-*`、12 个注册面、`apps/server/libs/r3-probe-lib/`），全部已还原或移出仓库。

---

## 需要 Lead 拍板

1. **【必须，挡提交】修 `steps.test.ts` 两处副本 + `release.md` 电池表**（§5.3）。最小改法：`steps.test.ts:35` 在 `['boundaries']` 后插 `['madge:check'],`；`release.md` 在 `boundaries` 行后插 `circular` 行。**不修就不该提交** —— HEAD 上 `pnpm --filter @walnut/release test` 是红的。
2. **knip 的 114 条噪音怎么办**：N1 修根因 / N2 给 3 个 barrel 加 `ignoreIssues`（114 → 15）/ 只改文档。我倾向 **N2 + N4 本轮做，N1 下一批**（N1 要动 160 处 import，是独立一批的量）。
3. **contract 的盲区要不要坐实**：(a) 用 `exports` 形状做一次 A/B 把原因坐实；(b) 直接立 N4 的专用脚本。我倾向 **(b)**。
4. **`prepush` 要不要补 `test` 段**（D-5）：这是 `steps.test.ts` 那条红能一路活到 HEAD 的根因。补上会把全量测试时间加进推送前，需要你定预算。
5. **D-1 的措辞要不要修**：`knip.config.ts:21` 与 `knip.md:78` 的「`packages/**` 一条都没有」应改成「五个共享包」。5 分钟的活，但它是**会被下一轮 agent 当事实引用**的那句话。

---

**一句话回答：这次改造有没有让别的门禁/约定失效？**

**有 —— 它把发版电池的机械审计打破了：`packages/tooling/release` 的 `steps.test.ts` 现在 2 个用例红（`steps.test.ts:35` 的 argv 夹具与 `steps.test.ts:179` 对 `release.md` 电池表的逐字对账都没跟着 `steps.ts:66` 的 `circular` 行走），而 `prepush` 没有 `test` 段 ⇒ 这类红推不出去也拦不住，只能靠 CI 的 `Tests (affected)`；其余三条负对照（boundaries / knip barrel / eslint 分层）、madge 段、脚手架、`lint:turbo-cache` 反向断言、fork PR 路径均按预期工作。**
