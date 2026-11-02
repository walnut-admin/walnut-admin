# 批次 2（门禁可信化）· R2 实施轮报告

> 任务：按 `reports/batch-2/r1-verification.md` 的实测结论落地四件事（D18① / D18② / D19 / D14）。
> 环境：Windows + pwsh，命令一律 `cmd /c "pnpm ..."`。**未 git commit**（交 Lead 统一提交）。
> 每条结论都带 `path:line` 或可复跑命令 + 实际输出；探针全部已还原。

---

## 0. 环境与前置事实（与 R1 的差异）

| 项 | R1 记录 | R2 实测 |
|----|---------|---------|
| HEAD | `c8bea21a` | 起步 `68f2a1fa`（工作树 clean）；会话中**同伴提交到 `6b45edc8`**（2026-11-02 23:04） |
| 并发 | 会话中有同伴改 `apps/**` | 仍然有：会话期间 `apps/server` 下 20+ 个文件被同伴改动，`apps/server/openapi.json` 也被改过（都不是我改的） |
| lockfile | `pnpm <script>` 会自动 install 并改写 | 本轮跑了 `boundaries` / `knip` / `lint` / `types:check` / `test` / `madge:check` / 7 个 `lint:*`，**每次 `git status --porcelain -- pnpm-lock.yaml` 都是空** |

**探针还原记录**：每个注入都用 `git checkout -- <path>` 或 `Move-Item`（移出仓库，未永久删除）还原，正文各节都贴了「还原后 diff 为空」的输出。

---

## 1. 改动清单（9 改 + 5 新）

| # | 文件 | 改了什么 | 位置 |
|---|------|----------|------|
| 1 | `turbo.json` | 新增 `platform-web.dependencies.deny: ["platform-node"]` + 理由注释 | `turbo.json:51-65` |
| 2 | `knip.config.ts` | 顶部注释补「`packages/**` 何时进入分析面」+「barrel 盲区」两段；5 个共享包各补 `project` + `includeEntryExports: true` | `knip.config.ts:18-41`、`:126-164` |
| 3 | `apps/docs/src/zh-CN/content/monorepo/knip.md` | 「预期结果」表纠正（`knip:packages` 不再是零发现）；新增「共享包进入分析面」一节（实测表 + 探针表）；「已知技术局限」补 barrel 条目；新包片段补两行；CI 建议改为「暂时不要当硬门禁」 | `knip.md:38-41`、`:59-100`、`:176-181`、`:225-240` |
| 4 | `package.json` | 新增根脚本 `madge:check`、`scaffold:lib` | `package.json:58`、`:64` |
| 5 | `packages/tooling/scripts/src/ci/prepush.ts` | 门禁表新增第 2 段 `circular`（并行段） | `prepush.ts:75-83` |
| 6 | `packages/tooling/scripts/src/ci/__tests__/prepush.test.ts` | id 顺序表加 `circular`；新增 2 个用例（「链路真的带 `--circular`」+「负对照：真造环必红 / 正对照：无环必绿」） | `prepush.test.ts:31-100` |
| 7 | `.github/workflows/ci.yml` | quality job 新增 `Circular dependency check (madge)` 步骤（紧跟 boundaries） | `ci.yml:66-70` |
| 8 | `packages/tooling/release/src/release/steps.ts` | 发版电池新增 `circular` 行（`gate-wiring` 要求每段都有 CI + 电池触发面） | `steps.ts:66` |
| 9 | `packages/tooling/scripts/package.json` | 新 bin `walnut-scaffold-lib` | `package.json:31-32` |
| N1 | `packages/tooling/scripts/bin/scaffold-lib.ts` | 新：bin 入口（`await runCli(main)`） | 新文件 |
| N2 | `packages/tooling/scripts/src/scaffold/lib-registration.ts` | 新：注册面的纯文本变换（每个都幂等）+ `planScaffold` / `applyScaffold` | 新文件 |
| N3 | `packages/tooling/scripts/src/scaffold/scaffold-lib.ts` | 新：参数解析 + 打印改动 + 落盘 | 新文件 |
| N4 | `packages/tooling/scripts/src/scaffold/__tests__/lib-registration.test.ts` | 新：11 个用例（幂等、逐面插入、JSON 仍合法、真实文件上 12 面 + 2 新文件） | 新文件 |

---

## 2. D18① 前端缺口：复用 `platform-web` tag（未新建 `frontend` 键）

规则在 `turbo.json:61-65`（片段逐字）：

```jsonc
      "platform-web": {
        "dependencies": {
          "deny": ["platform-node"]
        }
      }
```

**负对照（三段，全部实跑）**：

| # | 状态 | 命令 | 实测输出 | 判定 |
|---|------|------|----------|------|
| 1 | 净树 | `node_modules\.bin\turbo.cmd boundaries` | `Checked 4656 files in 15 packages, no issues found`，**exit 0** | 加规则不引入存量红 |
| 2 | 注入 `apps/admin/package.json` 的 `dependencies` 加 `"@walnut/server": "workspace:*"` | 同上 | **exit 1，1 issue**：`x Package \`@walnut/server\` found with tag listed in denylist for \`@walnut/…` + `->  x denylist defined here`，caret 指向 `"deny": ["platform-node"]` 那一行 | 门禁生效 |
| 3 | `git checkout -- apps/admin/package.json` | 同上 | 回到 `no issues found`，**exit 0** | 已还原 |

**另一条反向断言**：`pnpm lint:turbo-cache` **exit 0**（`91 个 task、15 个包，全部成立`）—— 它要求 `boundaries.tags` 的每个 key 都有包真的声明该 tag，`platform-web` 由 `apps/admin` + `packages/platform-web/{api-types,client,http}` 四包声明，所以这条规则**不会退化成恒关规则**。

`pnpm boundaries`（管线走 `cmd /c`）最终态：**exit 0**，`Checked 4656 files in 15 packages, no issues found`。

---

## 3. D18② knip：落地 `project` + `includeEntryExports`（唯一有效开关）

5 个共享包各补两行（`knip.config.ts:131-165`）：

```ts
    'packages/platform-any/contract': {
      entry: ['src/index.ts'],
      project: ['src/**/*.ts'],
      includeEntryExports: true,
    },
```

### 3.1 改前 / 改后（各跑一次 `pnpm knip`，全表逐行解析）

| | Unused files | Unused exports | Unused exported types | Duplicate exports | Hints | exit |
|---|---|---|---|---|---|---|
| 改前 | 15 | **50** | **24** | 1 | 90 | 1 |
| 改后 | 16 | **139** | **49** | 1 | 90 | 1 |
| 变化 | +1 | **+89** | **+25** | 0 | 0 | 保持 1（有意） |

**每一处变化都能对上号**：

- `Unused files` +1 是**同伴**新加的 `apps/server/apps/api/migrations/1793380000000-DeviceStaleFlag.ts`（`git status` 里是 `??`，不在我的改动面内）。
- `Unused exports` +89 全部落在 `packages/**`，按文件分布：`packages/platform-web/client/src/index.ts` **53**、`packages/platform-any/utils-core/src/index.ts` **22**、`packages/platform-web/http/src/index.ts` **7**（这三处都是 barrel 本身），其余 7 条在 `client` 的深层文件（`browser/cookie.ts` 2、`browser/shared.ts` 1、`browser/crypto/shared.ts` 1、`file/download.ts` 1、`hooks/vueuse/useDraggableElement.ts` 1、`store/createWalnutStore.ts` 1）。
- `Unused exported types` +25：`utils-core` 9、`client` 3、`http` 13。
- 结论：改前那 50 条**全部**在 `apps/**`，`packages/**` 一条都没有 —— 不是干净，是**整块没被分析**。

### 3.2 与 R1 的一处**实测修正**：barrel 不是「一律盲区」

R1 的 B7 结论是「barrel 自身的死导出仍然查不出」。本轮用**同一份配置做了 A/B 探针**（各追加一行，跑完 `git checkout --` 还原）：

| 探针 | 结果 |
|---|---|
| `export const __R2_LOCAL_IN_BARREL = 1` 追加到 `packages/platform-web/http/src/index.ts` | **报出来了**：`…/src/index.ts:25:14` |
| `export const __R2_DEAD_BARREL = 1` 追加到 `packages/platform-any/contract/src/index.ts` | **没报**（同一次运行、同一个开关） |
| `export { Role as __R2_REEXPORT_IN_BARREL } from './role'` 追加到同一个 contract barrel | **没报** |
| `export const __R2_DEEP_LOCAL = 1` 追加到非 entry 的 `packages/platform-any/contract/src/role.ts` | **报出来了**：`…/role.ts:25:14` |

所以准确口径是：**`includeEntryExports` 能看见一部分 barrel 的死导出（`http` / `client` / `utils-core` 三处一次报出 82 条），但没有稳定判据** —— contract 是反例，原因未查清（它是唯一带 `packages/platform-any/contract/scripts/build-barrel.ts` 生成 barrel 的包，怀疑与 entry 推导有关，**未验证**）。

文档因此写成「**部分盲区**」而不是「盲区」，并把「要稳定守这一面只能另立 barrel 专用脚本」写进了两处（`knip.config.ts:18-41` 与 `knip.md:176-181`）。任务书要求的「写进 `knip.config.ts` 顶部注释与 `monorepo/knip.md`」已完成，只是措辞按实测收窄了。

### 3.3 文档同时修掉的两处会烂的说法

- `knip.md:38-41` 原写「`pnpm knip:packages` **exit 0，零发现**」—— 那是假绿的产物；现在如实写成「自 2026-11-02 起 exit 1 有发现」。
- `knip.md:225-240` 的「CI 集成建议」原写「packages 零误报，exit 0 即健康」—— 改成「暂时不要当硬门禁，先分类再开闸」。

---

## 4. D19 madge 进 prepush（五处接线，一段并行门禁）

| # | 面 | 位置 | 内容 |
|---|----|------|------|
| 1 | 根脚本 | `package.json:58` | `"madge:check": "pnpm -C apps/server madge"` |
| 2 | prepush 表 | `prepush.ts:75-83` | `{ id: 'circular', argv: ['madge:check'], why: … }`（第 2 段，并行执行器里跑；`boundaries` 之后） |
| 3 | CI | `.github/workflows/ci.yml:66-70` | `Circular dependency check (madge)` → `run: pnpm madge:check` |
| 4 | 发版电池 | `steps.ts:66` | `{ id: 'circular', argv: ['madge:check'] }`（`gate-wiring.test.ts` 要求每段都有 CI 与电池触发面，漏一处就红） |
| 5 | 测试 | `prepush.test.ts` | id 顺序表 + 2 个新用例（见下） |

现状：`PREPUSH_GATES` **25 段**（直接 import 打印）：`boundaries, circular, lint, lint-root, types, …`。

### 4.1 成本实测

| 场景 | 输出 | 耗时 |
|------|------|------|
| 净树（本机有并发同伴在跑门禁） | `Processed 1053 files (14.2s) (18 warnings)`，exit 0 | 14.2s |
| 注入环那次（多 2 个文件） | `Processed 1055 files (21.2s)` | 21.2s |
| R1 记录 | `Processed 1050 files (9.6s)` | 10.3s |

与表里最慢的 `lint`（本次实测 2m36s）/ `types:check`（35s）比，10–21s 落在并行段里不构成瓶颈。

### 4.2 「环 = 失败」的三条证据（都是实测，不是对配置的解读）

**(a) 端到端负对照**：造 `apps/server/libs/utils/src/probe-cycle-a.ts` 与 `probe-cycle-b.ts` 互相 import，跑 prepush 该段的 `argv[0]`：

```
$ madge --circular --ts-config tsconfig.json apps/api/src libs --extensions js,ts,tsx
Processed 1055 files (21.2s) (18 warnings)
× Found 1 circular dependency!
1) libs/utils/src/probe-cycle-a.ts > libs/utils/src/probe-cycle-b.ts
[ELIFECYCLE] Command failed with exit code 1.
```

→ **exit 1**。删掉两个探针后重跑：`Processed 1053 files (14.2s)`，**exit 0**；`git status --porcelain -- apps/server/libs/utils` 为空（已还原）。

**(b) 单测负对照 + 正对照**（`prepush.test.ts`）：在 `os.tmpdir()` 下现造两个互相 import 的 `.ts`，用 `node <apps/server/node_modules/madge/bin/cli.js> --circular --extensions ts <dir>` 真跑一次，断言 `status !== 0` 且输出含 `circular`；同一用例再造一对无环文件，断言 `status === 0`（防止「永远失败」也能让上一条绿）。

**(c) 防「门禁被改软」**：断言 `apps/server` 的 `madge` 脚本里必须含 `--circular` 且含 `--extensions` —— 少了前者它只输出文件清单（永远 0 环），少了后者 madge 默认只认 `.js`（本仓 1053 个文件里 `.ts` 占绝大多数 ⇒ **静默 0 环**）。

---

## 5. D14 注册面脚手架 `walnut-scaffold-lib`

### 5.1 它改哪 14 个文件（12 既有 + 2 新建）

| 面 | 文件 | 增量 | 实测 |
|----|------|------|------|
| ① tsconfig paths | `apps/server/tsconfig.json` | +6 | +6 / 0 |
| ② nest filenames | `infra/nest/{dev,prod,stage}.json` | 各 +1 | 各 +1（含在下一行） |
| ③ nest projects | 同上三份 | 各 +9 | 各 +9（`+10 / -0` 合计含 filenames） |
| ④ swc paths | `infra/swc/{dev,prod,stage}.swcrc` | 各 +2 | 各 `+3 / -1`（末行改逗号） |
| ⑤ app include | `apps/{api,cli,worker}/tsconfig.app.json` | 各 +1 | 各 `+2 / -1` |
| ⑥ eslint 分层名单 | `apps/server/eslint.config.ts` | 改 1 行 | `+1 / -1` |
| ⑦ 分层矩阵 | drift spec 的 `LAYER_MATRIX` | 改 1 行 | `+1 / -1` |
| ⑧ 新文件 | `libs/<x>/tsconfig.lib.json`、`libs/<x>/src/index.ts` | 2 个 | 6 行 / 9 行 |

**与 R1「9 文件 / ≈41 行」的对账（三处偏差，都是 R1 低估）**：

1. **nest `projects` 块是 9 行不是 8 行**（`"<x>": {` / type / root / entryFile / sourceRoot / compilerOptions { / tsConfigPath / } / }）→ 三份共 +27 而不是 +24；
2. **`tsconfig.app.json` 有 3 个**（api / cli / worker 都有 include 列表），R1 只算了 `apps/api` → +3 而不是 +1；
3. **R1 的 9 文件清单漏了第 10 个既有文件**：drift spec 里的 `LAYER_MATRIX` 是「按 ADR 0022 应该长什么样」的**独立表述**，只改 `eslint.config.ts` 不改它，`layer libs 并集 ≠ 矩阵` 立刻红。所以脚手架也必须改它。

合计：**净增 45 行**（git 口径 `53 insertions(+), 8 deletions(-)`，其中 8 条 deletion 是 8 处被改写的行），12 个既有文件 + 2 个新文件。

### 5.2 验收实测（完整四步）

```
$ node packages/tooling/scripts/bin/scaffold-lib.ts probe-lib --layer=tech-base
lib probe-lib（层 tech-base）：注册面共 14 个文件，待改 14 个
  ~ apps/server/tsconfig.json（+6 行）
  ~ apps/server/infra/nest/dev.json（+10 行）   ← 1 filenames + 9 projects
  …
  + apps/server/libs/probe-lib/tsconfig.lib.json（新文件，7 行）
  + apps/server/libs/probe-lib/src/index.ts（新文件，9 行）
(输出) 已写入 14 个文件
$ git diff --shortstat -- <12 个注册面文件>
 12 files changed, 53 insertions(+), 8 deletions(-)
$ pnpm --filter @walnut/server types:check        → exit 0
$ (cd apps/server) vitest run … lib-registration.drift.spec.ts
 Test Files  1 passed (1)   Tests  9 passed (9)   [exit 0]
$ node …/scaffold-lib.ts probe-lib --layer=tech-base     # 第二次
lib probe-lib（层 tech-base）：注册面共 14 个文件，待改 0 个
(输出) 已经是最终态（零改动）—— 幂等，未写任何文件
$ git diff --shortstat -- <同上>  → 12 files changed, 53 insertions(+), 8 deletions(-)   # 完全不变
```

回滚：`git checkout --` 12 个文件 + 把 `apps/server/libs/probe-lib` 移出仓库（`trash` 本机不存在，改 `Move-Item` 到 `%TEMP%`，可恢复）→ 注册面 diff 为空、目录不存在。

**关键点**：drift spec 的 **9 个用例全绿**是「注册面真的齐了」的判据 —— 它不是我说绿的，是那份 714 行守卫在 14 个面同时改动后依然成立。

### 5.3 有意不支持的四层（fail-closed）

`identity` / `system` / `auth` / `security` 四层拒绝自动登记并给出明确报错：它们的 `layer(...)` 接线是「单成员层」写法（`...DOMAIN_LIBS.filter(lib => lib !== 'identity')`），塞第二个 lib 会让 rank 推导出的 banned 集合与接线对不上（drift spec 会红，但报错位置离原因很远）。工具把原因和手工改法打在报错里，不猜。`guards` / `app-domain` 这两层（也是字面量数组）**支持**，走 `insertLayerLiteral`。

---

## 6. 必须跑的门禁（最终态实测）

| 命令 | 退出码 | 关键输出 |
|------|--------|----------|
| `cmd /c "pnpm boundaries"` | **0** | `Checked 4656 files in 15 packages, no issues found` |
| `cmd /c "pnpm knip"` | **1**（有意维持） | `Unused files (16)` / `Unused exports (139)` / `Unused exported types (49)` / `hints (90)`（变化见 §3.1） |
| `cmd /c "pnpm lint"` | **0** | `Tasks: 15 successful, 15 total`，`Time: 2m35.776s` |
| `cmd /c "pnpm --filter @walnut/scripts test"` | **0** | `Test Files 31 passed (31)` / `Tests 512 passed (512)` |
| `cmd /c "pnpm types:check"` | **0** | `Tasks: 15 successful, 15 total`，`Time: 35.186s` |
| `cmd /c "pnpm lint:turbo-cache"` | **0** | `91 个 task、15 个包，全部成立` |
| `cmd /c "pnpm lint:doc-ts"` | **0** | `230 篇活文档里的 125 个 ts 块 + 3 个 json 块` 全部合法 |
| `cmd /c "pnpm lint:emoji"` | **0** | `1205 个被跟踪的文本文件`，无 emoji |
| `cmd /c "pnpm lint:doc-budget"` | **0** | 都在预算内 |
| `cmd /c "pnpm lint:docs-refs"` | **0** | `325 篇活文档`，无失效引用（中途我写过一个裸路径 `scripts/build-barrel.ts` 被它抓到，已改成全路径） |
| `cmd /c "pnpm lint:workflows"` | **0**（**但跳过了**） | `未检测到 actionlint，跳过 workflow 校验` → 我另用 `yaml.parse` 验证 `ci.yml`：`jobs: quality, build, openapi`，madge 步骤在 `Architecture boundaries` 之后、`run: pnpm madge:check` |

`pnpm-lock.yaml`：全程**未被改写**（每次跑完都核对）。

---

## 7. 结论：哪些门禁**现在真的会红**

| 失效面 | 会红吗 | 依据 |
|--------|--------|------|
| 前端（admin / platform-web 库）依赖平台 Node 包 | **会红** | 本轮新规则，注入实测 exit 1（§2） |
| 后端依赖前端包 | 会红 | 既有 `backend.deny platform-web`，R1 A1 实测 |
| 跨包循环依赖（workspace 包之间） | 会红 | 既有 `platform-any.deny platform-web` + R1 A1 的 `Circular package dependency detected` |
| `apps/server` 内 lib 之间 / 跨模块的环 | **会红（本轮新增）** | madge 段；造环实测 exit 1，报出精确链路（§4.2a） |
| lib 向上层 import（分层方向错） | 会红 | `apps/server/eslint.config.ts` 的 `no-restricted-imports`，R1 C1 实测 |
| 加一个 lib 却漏登记某个注册面 | 会红 | drift spec 9 用例；本轮顺带证明它把 `LAYER_MATRIX` 也算注册面 |
| 共享包 barrel 级死导出 | **部分会红，不可依赖** | A/B 探针：`http` 报得出来、`contract` 报不出来（§3.2） |
| knip 的全部发现（139 条） | **不会拦人** | 它仍不在 prepush / CI / 发版电池里（有意维持红，见 `knip.config.ts` 头部）；本轮只是让它**看得见** |

一句话：**这一轮真正补上的新方向只有两个** —— 「前端不得消费 Node 包」和「不得有环」；knip 那一项是**可观测性**（且仍有盲区），不是新闸。

---

### 附：与任务书的偏离（三处，都是有意的）

1. **barrel 盲区的措辞**：任务书要求写「仍是盲区」；实测是「**部分**盲区、因包而异」，所以按实测写，并把这个修正单列在 §3.2。
2. **D14 行数**：任务书说「41 左右」，实测净增 **45 行 / 53 insertions + 8 deletions**，三处偏差逐条对账见 §5.1。
3. **新增测试的位置**：任务书要求「配一条测试断言『环 = 失败』」，我把它写成 `prepush.test.ts` 里的**真跑 madge** 的负对照（而不是只断言表结构），代价是该用例会起一个子进程（约 1–2s）。

---

## 需要 Lead 拍板

1. **`pnpm scaffold:lib` 目前还不能直接跑**：新 bin 的 shim 由 `pnpm install` 生成，而我没跑 install（避免动 lockfile）。验收用的是 `node packages/tooling/scripts/bin/scaffold-lib.ts …`（同一条 `main()`）。提交前是否跑一次 `pnpm install` 让 shim 落地？（bin 增删不改依赖图，理论上 `pnpm-lock.yaml` 不会变，但需要有人真跑一次确认。）
2. **knip 从 50 → 139 条**（+89）是否接受？三个选项：(a) 维持现状 + 已写的文档口径（本轮的选法）；(b) 给 `client` / `utils-core` / `http` 三个 barrel 的存量发现加 `ignoreIssues`，只留深层文件的 7 条；(c) 认为噪音不可接受就回退 `includeEntryExports`（但实测那样等于没做，0 变化）。我倾向 (a)。
3. **contract 的 barrel 例外要不要查清**？它同时是唯一带 `packages/platform-any/contract/scripts/build-barrel.ts` 的包。选项：(a) 花一轮把原因坐实（可能牵出 knip 的 entry 推导细节）；(b) 不做，下一轮直接写「barrel 符号 0 引用」专用脚本（能覆盖所有包，含 contract）。我倾向 (b)。
4. **D14 的四个域层（identity / system / auth / security）拒绝自动登记**，接受吗？接受的话建议把这条写进 `apps/server/AGENTS.md` —— 我没动那份常驻文档（它已在 84% 预算，加字要先算预算）。
5. **CI 的 actionlint 本地没装**，我加的 `ci.yml` 步骤只做了 YAML 解析验证。要不要在提交前装一次 actionlint 真跑 `pnpm lint:workflows`？（步骤形态极简，风险低，但「本地没验过」这件事必须记在案。）

