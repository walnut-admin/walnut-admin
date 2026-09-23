# pnpm 12 升级 + 基建配置清理 迁移计划

> 📦 **归档文档（2026-09-21 计划，已执行）**：计划中的 pnpm 12.5.1 升级与基建整理已落地（见 [pnpm-workspace.yaml 详解](/content/monorepo/pnpm-workspace-config)），本文保留为过程记录。

> **日期**：2026-09-21 ｜ **目标版本**：pnpm `12.5.1` ｜ **基线**：HEAD `5c64f2a`，当前 `packageManager: pnpm@11.20.0`
> **配套**：[架构 Review](2026-09-21-architecture-review.md)（§4.6 是动因）、[调研文档审计](2026-09-21-industry-research-audit.md)
> **范围**：仅**基建层面**（pnpm / workspace / CI / Docker 配置），**不碰任何业务代码**
> **归档位置**：原在仓库根 `docs/reviews/`，现已迁入文档站 `content/archive/`。

---

## 摘要

三件事一起做：

1. **清理基建层面的 legacy 与特异性配置**（`.npmrc` 载体、`hoisting`、`overrides`、`minimumReleaseAgeExclude`、`preinstall`、`peerDependencyRules`、`allowBuilds`）
2. **升级到 pnpm 12.5.1**（Rust 重写版，2026-08 发布）
3. **让「严格依赖隔离」真正生效**（`hoist: false` + 修复被掩盖的幻影依赖）

**⚠️ 核心顺序约束**：pnpm 12 有一处破坏性变更——项目**有版本 pin 时**，未识别的 `pnpm-workspace.yaml` 键会让安装**硬失败**（`ERR_PNPM_UNRECOGNIZED_WORKSPACE_SETTINGS`）。本仓有 pin，所以 `hoisting: false` 必须**先修**，否则升到 12 后装不上。

**✅ 已实测的好消息**：现有 `lockfileVersion: '9.0'` 被 pnpm 12 **直接接受**（`Lockfile is up to date, resolution step is skipped`），升级不涉及 lockfile 格式迁移。

**⚠️ 已实测的新成本**：pnpm 12 在安装路径上做供应链策略校验（`minimumReleaseAge` 默认 1440 分钟）——冷启动 **34.4s / 2855 条目**，热缓存 0.3s。CI 若缓存不覆盖，每个 install job 预计 +30~40s。

---

## 决策记录（2026-09-21）

| # | 议题 | 决定 |
|---|------|------|
| 1 | "legacy API" 的范围 | **基建层面**（pnpm / workspace / CI 配置），**不涉及业务代码** |
| 2 | 特异性配置清理范围 | **全清**：`hoisting` / `overrides: glob` / `minimumReleaseAgeExclude` / `preinstall: npx only-allow` / `peerDependencyRules.allowedVersions` / `allowBuilds` |
| 3 | `allowBuilds` 的处理策略 | **先全部移除，出问题再逐条加回**（pnpm 会打印 `Ignored build scripts` 清单，逐条回加很容易） |
| 4 | Phase 1b 与 Phase 2 顺序 | **先升 pnpm 12，再翻 hoist** |
| 5 | `.npmrc` 的设置 | **全部迁到 `pnpm-workspace.yaml`**（`strictPeerDependencies` / `engineStrict` / `saveExact` / `publicHoistPattern`），不逐个实测 |

> **⚠️ 决策 5 有一个已知风险，见 §六-风险 R2**：`engineStrict` 迁过去等于**真正激活**它，而 pnpm 12 把它从"沿子树"改成"沿依赖边"生效——这正是它此前被 `.npmrc` 失效"意外保护"着的地方。**若升级后安装报 engine 相关错误，第一个怀疑对象就是它。**

---

## 一、当前基建配置全清单（本次要动的对象）

### 1.1 `.npmrc`（8 行，**全部为非 auth/registry 内容**）

```ini
strict-peer-dependencies=true
engine-strict=true
save-exact=true
public-hoist-pattern[]=*turbo*
public-hoist-pattern[]=*eslint*
public-hoist-pattern[]=*simple-git-hooks*
public-hoist-pattern[]=*@swc*
public-hoist-pattern[]=*esbuild*
```

pnpm 官方口径：*"Only auth and registry settings are read from `.npmrc` files. All other settings must be configured in `pnpm-workspace.yaml`."*

其中 `public-hoist-pattern` 已**实测证伪**：

| 包 | 根 `node_modules` | `.pnpm/node_modules` | 是根直接依赖 | 判定 |
|---|:---:|:---:|:---:|---|
| `turbo` / `eslint` / `simple-git-hooks` | ✅ | ❌ | ✅ | 来自**直接依赖**，非 pattern 生效 |
| `@swc` / `esbuild` | ❌ | ✅ | ❌ | **pattern 未生效** |

→ 文件本身不含 auth/registry，**迁移完设置后整个文件可删**。

### 1.2 `pnpm-workspace.yaml` 的 7 个区块

| 行 | 配置 | 处置 |
|---|---|---|
| L1 | `catalogMode: strict` | **保留** |
| L3-5 | `minimumReleaseAgeExclude`（2 条 `@dotenvx` 版本豁免） | **移除** |
| L6-10 | `packages`（4 条 glob） | **保留** |
| L12 | `hoisting: false` | **改 `hoist: true`**（过渡），Phase 1b 再翻 `false` |
| L14-15 | `overrides: glob: 11.1.0` | **移除**，跑一遍验证是否真需要 |
| L17-259 | `catalog`（243 条） | **保留**（本次一条都不动） |
| L268-274 | `peerDependencyRules.allowedVersions`（5 条） | **移除**，观察 `pnpm peers check` 的 5 条告警 |
| L276-292 | `allowBuilds`（16 条） | **全部移除**，按 pnpm 的 `Ignored build scripts` 清单逐条加回 |

### 1.3 根 `package.json`

| 项 | 现值 | 处置 |
|---|---|---|
| `packageManager` | `pnpm@11.20.0` | → `pnpm@12.5.1` |
| `preinstall` | `npx only-allow pnpm` | → `pnpm exec only-allow pnpm` + `only-allow` 入 devDeps（**去掉每次安装的网络拉取**，保留守卫） |

### 1.4 其余钉版本位置

| 位置 | 现值 |
|---|---|
| 12 个 `package.json` 的 `engines.pnpm` | `>=11.0.0` → `>=12.0.0` |
| `apps/admin/Dockerfile:6`、`apps/server/Dockerfile:6` | `corepack prepare pnpm@11.20.0` → `pnpm@12.5.1` |
| `.github/workflows/deploy.yml:27` | 注释里的版本号（**代码不用改**，读 `packageManager`） |

---

## 二、⚠️ 顺序约束

```
Phase 1a  基建配置清理（hoist: true 过渡，行为等效）
   ↓
Phase 2   升 pnpm 12.5.1                          ← 机械、已验证 lockfile 兼容
   ↓
Phase 1b  翻 hoist: false + 修幻影依赖             ← 高风险，独立提交
   ↓
Phase 1c  清空 allowBuilds + 逐条加回              ← 中风险，独立验证
   ↓
Phase 3   pnpm 12 安全能力（minimumReleaseAge / trustPolicy / blockExoticSubdeps）
   ↓
Phase 4   文档同步
```

**三条设计理由**：

1. **`hoist` 必须先改**——不改就升 12 会直接装不上（§摘要的硬约束）。
2. **`hoist: true` 是过渡态而非终态**——先把"键名修正"和"行为变更"拆开。若 Phase 1b 出问题，能确定是 hoisting 行为导致，而非键名修正的副作用。
3. **`allowBuilds` 单独成阶段**——它与 `hoist: false` 都会引发"缺东西"类故障，混在一起无法归因。且清空后 `simple-git-hooks` 的 postinstall 不会执行（**git hooks 装不上**），必须单独观察。

---

## 三、分阶段计划

### Phase 0 — 基线与探测（0.5h，不改任何文件）

| # | 步骤 | 验证 |
|---|------|------|
| 0.1 | 记录基线：`pnpm install --frozen-lockfile` → `lint` → `types:check` → `test` → `boundaries` → `build` | 全绿 + 记录耗时 |
| 0.2 | 记录 `node_modules/.pnpm/node_modules` 条目数（当前 **1647**） | Phase 1b 的对照基线 |
| 0.3 | **先跑一次不修的幻影依赖探测**：`pnpm knip` 或 `knip --include dependencies` | 把清单摸出来，才能估 Phase 1b 的工作量 |
| 0.4 | 记录 CI 各 job 耗时（quality / build） | Phase 2/3 的成本对照 |

> **0.3 是关键**：Phase 1b 的工作量完全取决于此。先探测再决定是一次做完还是分几次。

---

### Phase 1a — 基建配置清理（低风险，1-2h）

**目标**：删除 legacy 载体与特异性配置，把仍需要的设置迁到正确位置，**不改变实际行为**。

| # | 文件 | 改动 |
|---|------|------|
| 1a.1 | `pnpm-workspace.yaml:12` | `hoisting: false` → **`hoist: true`**（过渡态，附注释说明 Phase 1b 会翻 `false`） |
| 1a.2 | `pnpm-workspace.yaml` | **新增** `strictPeerDependencies: true`、`engineStrict: true`、`saveExact: true`（自 `.npmrc` 迁入） |
| 1a.3 | `pnpm-workspace.yaml` | **新增** `publicHoistPattern:` 数组（自 `.npmrc` 的 5 条迁入） |
| 1a.4 | `.npmrc` | **删除整个文件**（迁移后已无内容；本就不含 auth/registry） |
| 1a.5 | `pnpm-workspace.yaml:14-15` | 移除 `overrides: glob: 11.1.0` |
| 1a.6 | `pnpm-workspace.yaml:3-5` | 移除 `minimumReleaseAgeExclude` 两条 |
| 1a.7 | `pnpm-workspace.yaml:268-274` | 移除 `peerDependencyRules.allowedVersions` |
| 1a.8 | 根 `package.json` | `preinstall` → `pnpm exec only-allow pnpm`；`only-allow` 加入 devDependencies（走 `catalog:`） |

> ⚠️ **1a.7 的预期后果**：`pnpm peers check` 会重新报出 5 条 peer 错位（`@swc/cli`、`chokidar`、`class-validator`、`typescript`、`vite`）。这是**故意的**——先看清楚真实告警，再决定是升级上游 peer 范围、还是带着理由重新豁免。
>
> ⚠️ **1a.2 的 `engineStrict: true` 是本次最高风险项**，理由见 §六-风险 R2。

**验证**：
- `pnpm install --frozen-lockfile` 成功，**无 unrecognized 警告**（用 pnpm 12 验证，见 Phase 2）
- `node_modules/.pnpm/node_modules` 条目数仍 ≈1647（行为确实没变）
- `pnpm knip`、`pnpm lint`、`pnpm types:check`、`pnpm test`、`pnpm boundaries`、`pnpm build` 全绿
- `pnpm peers check` —— **记录**新增的 5 条告警（不修，只记录）
- **确认 `glob` 移除后无影响**：`pnpm why glob` + 构建通过

**回滚**：`git revert` 单提交即可（配置类改动）。

---

### Phase 2 — 升级 pnpm 12.5.1（机械变更，1-2h）

| # | 文件 | 改动 |
|---|------|------|
| 2.1 | 根 `package.json:6` | `"packageManager": "pnpm@12.5.1"` |
| 2.2 | 12 个 `package.json` 的 `engines.pnpm` | `">=11.0.0"` → `">=12.0.0"` |
| 2.3 | `apps/admin/Dockerfile:6` | `corepack prepare pnpm@11.20.0` → `pnpm@12.5.1` |
| 2.4 | `apps/server/Dockerfile:6` | 同上 |
| 2.5 | `.github/workflows/deploy.yml:27` | 注释里的版本号同步 |
| 2.6 | 本地 | `corepack prepare pnpm@12.5.1 --activate` |

**暂不引入 `devEngines.packageManager`**——pnpm 12 推荐它与 `packageManager` 对齐，但它是新增机制，本阶段引入会扩大变量。等稳定后单独评估。

**验证**：
- `pnpm install` 成功；**观察是否出现一次性 lockfile diff**（pnpm 12 的循环依赖去重）
  - 若有：**单独成一个提交**，说明是 pnpm 12 循环去重
- `pnpm install --frozen-lockfile` 二次运行幂等
- 全量 lint / types:check / test / boundaries / build 全绿
- **重点验证 `pnpm lint`**：上游曾因兼容性数据库变更导致旧 `@typescript-eslint` 撞上 TS 7、ESLint 崩溃。本仓 `eslint@10.3.0` + `@antfu/eslint-config@8.2.0`，需确认无影响
- CI 跑通（推分支触发）

**回滚**：`packageManager` 改回 `pnpm@11.20.0` + `git checkout pnpm-lock.yaml`。lockfile 格式未变，回滚成本低。

---

### Phase 1b — 翻转 `hoist: false` + 修复幻影依赖（**高风险，0.5~2 天**）

| # | 步骤 |
|---|------|
| 1b.1 | `pnpm-workspace.yaml`：`hoist: true` → **`hoist: false`** |
| 1b.2 | 删 `node_modules` + 全量 `pnpm install` |
| 1b.3 | **逐层验证，每层全绿再进下一层**：`types:check` → `lint` → `build:server` → `build:admin` → `test` → `dev`（前后端） |
| 1b.4 | 对每处"找不到模块"，判断是**真幻影依赖**（补进该包 `package.json`）还是依赖本身缺失 |
| 1b.5 | 跑 `pnpm knip` 交叉验证，确认清单与 1b.4 的修复一致 |
| 1b.6 | 按包分组提交（如 `fix(admin): 补齐 N 处未声明依赖`），**不要一个巨型提交** |

**同时处理 `publicHoistPattern`**：迁移过来后需实测是否真的需要——若 `@swc`/`esbuild` 在 `hoist: false` 下仍能从各包自身 `node_modules` 解析到，则这 5 条可直接删除（比迁移更减配置面）。

**决定性验证**：
```
node_modules/.pnpm/node_modules 条目数：1647 → 接近 0（仅剩 workspace 内部链接）
```
这是本条修复生效的**唯一硬证据**。

**其它验证**：全量 lint / types:check / test / boundaries / build / dev / **Docker 三镜像构建**（容器内是干净安装，最能暴露问题）。

**回滚**：`hoist` 改回 `true` + 还原 `package.json` 依赖声明。

---

### Phase 1c — 清空 `allowBuilds` 并逐条加回（中风险，0.5~1h）

**策略（按决策 3）**：全部移除 → 观察 pnpm 的 `Ignored build scripts:` 清单 → 只把**确实需要**的加回。

| # | 步骤 |
|---|------|
| 1c.1 | 移除 `allowBuilds` 全部 16 条 |
| 1c.2 | `pnpm install` 后**记录 pnpm 打印的 `Ignored build scripts` 清单** |
| 1c.3 | 逐个判断，**按需加回**。已知需要关注的：见下表 |
| 1c.4 | 重新 `pnpm install` 确认清单收敛 |

**已知的高风险条目**（预判，仍需实测）：

| 包 | 为什么可能必须加回 |
|---|---|
| **`simple-git-hooks`** | 🔴 它的 postinstall **就是安装 git hooks 本身**。不加回则 pre-commit / pre-push 门禁全部失效——**而这一点不会报错，只会静默不执行** |
| `sharp` | 图像处理，可能需要下载/构建原生二进制 |
| `@swc/core`、`esbuild` | 现在多通过 optionalDependencies 分发预编译产物，**大概率不需要** postinstall |
| `@parcel/watcher`、`msgpackr-extract`、`rs-module-lexer`、`unrs-resolver` | 原生模块，视预编译产物情况 |
| `@nestjs/core`、`core-js`、`@scarf/scarf` | 多为 funding/telemetry 提示，**大概率可永久移除** |

> **⚠️ 1c 的隐蔽风险**：`simple-git-hooks` 失效是**静默的**。验证方式：`ls .git/hooks/` 确认 `pre-commit`/`pre-push` 存在且可执行，或故意提交一个 lint 违规看门禁是否拦下。

---

### Phase 3 — pnpm 12 安全能力（需决策，1-2h）

| 设置 | 现状 | 建议 |
|---|---|---|
| `minimumReleaseAge` | 未显式配置（用默认 1440 分钟） | **显式写出 `1440`**，让策略意图可见。提高安全性可设 `10080`（1 周），但会拖慢依赖升级 |
| `trustPolicy` | 未配置 | 评估 `no-downgrade`，**建议加**（成本低、收益明确） |
| `blockExoticSubdeps` | 未配置 | **建议设 `true`**。本仓无 git 依赖，风险极低 |
| 远程 side-effects 缓存 | — | PoC，**跳过** |
| CI 供应链校验成本 | 冷启动实测 **34.4s** | **实测 CI 冷缓存下的真实耗时**，确认 `cache: pnpm` 是否覆盖该校验缓存 |

---

### Phase 4 — 文档同步（不可跳过）

本次修复的核心教训就是"文档与配置脱节"，所以文档更新是必做项而非收尾。

| # | 文件 | 改动 |
|---|------|------|
| 4.1 | `apps/docs/.../monorepo/pnpm-workspace-config.md` | **按实测重写** `hoisting: false` 整节（L31-L41）：正确键名、为何此前失效、为何 pnpm 11 不报警 |
| 4.2 | `apps/docs/.../monorepo/pnpm-workspace-config.md` | **删除/重写** `.npmrc` 的 `public-hoist-pattern[]` 一节（L118-L125） |
| 4.3 | `apps/docs/.../monorepo/pnpm-workspace-config.md` | 重写 `overrides` 一节（L43-L52）——条目已移除 |
| 4.4 | `apps/docs/.../monorepo/index.md` | 修正关键设计决策 №4；技术栈速览的 pnpm 版本 |
| 4.5 | 根 `AGENTS.md` / `CLAUDE.md` | pnpm 版本要求 `>=12.0.0` |
| 4.6 | `apps/docs/.../monorepo/architecture-todo.md` | R2（knip 豁免裁剪）的新关联；新增本计划执行记录 |

> **建议顺手做掉** Review §5-F2 的 `verify-doc-refs` 门禁——**本计划里的每一个事实，当时若有门禁都能被自动发现**。

---

## 四、影响面与工作量

| 阶段 | 改动文件（估） | 工作量 | 风险 |
|---|---|---|---|
| Phase 0 基线探测 | 0 | 0.5h | — |
| Phase 1a 配置清理 | 3（`pnpm-workspace.yaml`、`.npmrc` 删除、根 `package.json`） | 1-2h | 🟢 低 |
| Phase 2 pnpm 12 升级 | **16**（1 + 12 + 2 + 1 注释） | 1-2h | 🟢 低（lockfile 已实测兼容） |
| Phase 1b hoist 隔离 | **未知，可能数十处 `package.json`** + 1 配置 | **0.5-2 天** | 🔴 **高** |
| Phase 1c allowBuilds | 1 | 0.5-1h | 🟡 中（静默失效风险） |
| Phase 3 安全能力 | 1 | 1-2h | 🟢 低 |
| Phase 4 文档同步 | 6 | 2-3h | 🟢 低 |
| **合计** | — | **约 2-3.5 天** | |

**CI 成本变化**：每个 install job 预计 **+30~40s**（冷缓存的供应链校验），Phase 3 实测确认。

---

## 五、明确不做的事

| 项 | 为什么 |
|---|---|
| 改动任何业务代码 | 本计划范围限定为基建层面 |
| 借机升级 catalog 里 243 条依赖 | 会污染变量，一条都不动 |
| 引入 `devEngines.packageManager` | pnpm 12 新增机制，等稳定后单独评估 |
| 迁移到 pnpm 12 的新命令族（`pnpx` / `pnpm shim`） | 与本次目标无关 |
| 同时做 Review §5 的 D1-D8 架构决策 | 那些需要单独讨论 |
| 用 `pnpm self-update` 全局升级 | 会改动机器全局状态；用 corepack + `packageManager` pin |

---

## 六、风险登记

| # | 风险 | 触发条件 | 缓解 |
|---|------|---------|------|
| **R1** | 🔴 **Phase 1b 暴露大量幻影依赖** | `hoist: false` 生效后 | Phase 0.3 先探测摸清清单；按包分批提交；随时可回滚 |
| **R2** | 🔴 **`engineStrict` 激活后安装失败** | 决策 5 把它迁到 `pnpm-workspace.yaml` 等于**真正激活**；而 pnpm 12 又把它从"沿子树"改成"沿依赖边"生效——此前它被 `.npmrc` 失效"意外保护"着 | **升级后若报 engine 相关错误，第一嫌疑就是它**。单独 revert 这一个键即可验证；必要时该项单独排期 |
| **R3** | 🟡 **`allowBuilds` 清空导致 git hooks 静默失效** | `simple-git-hooks` 的 postinstall 不执行 | Phase 1c 后**显式验证 `.git/hooks/`**；或先把 `simple-git-hooks` 一条加回再逐步放开其余 |
| **R4** | 🟡 **`overrides: glob` 移除后装出多份 glob** | 传递依赖各自解析 | `pnpm why glob` 检查副本数；若确有冲突再针对性恢复 |
| **R5** | 🟡 **移除 `peerDependencyRules` 后 `pnpm peers check` 报警** | 预期内 | 这是**故意**的——先看真实告警，再决定升级上游还是带理由豁免 |
| **R6** | 🟡 **CI 供应链校验拖慢流水线** | 缓存不覆盖该校验 | Phase 3 实测；必要时把校验与 install 拆开 |
| **R7** | 🟢 lockfile 一次性 diff | pnpm 12 循环依赖去重 | 单独提交，看清 diff 内容再接受 |
| **R8** | 🟢 ESLint 崩溃 | 上游兼容性数据库变更的已知事故 | Phase 2 重点验证 `pnpm lint` |

**通用回滚**：所有阶段都是配置类改动，`git revert` 即可。唯一例外是 Phase 2 的 lockfile diff——需同时 `git checkout pnpm-lock.yaml`。

---

## 七、立即可以开始的第一步

**Phase 0.3 是最有价值的起点**——它不改任何文件，但决定了 Phase 1b 是"半小时"还是"两天"：

```bash
pnpm knip            # 或 knip --include dependencies
```

把"未声明依赖"清单跑出来，再决定后面的排期。

---

## 附录：事实来源

| 类型 | 内容 |
|---|---|
| **本仓实测** | `pnpm install` 输出、`node_modules/.pnpm/node_modules` 条目计数（1647）、根 `node_modules` 目录清单、`.npmrc` / `pnpm-workspace.yaml` / `package.json` / `Dockerfile` 内容、全仓版本引用 grep、`git status` |
| **pnpm 12 隔离实验** | 临时目录 + 非法类型值，对比 `hoisting` 与 `hoist` 两种键名的 pnpm 反应 |
| **本仓 pnpm 12 试跑** | `corepack pnpm@12.4.1 install --frozen-lockfile --ignore-scripts --pm-on-fail=ignore`（只读，`git status` 确认零改动），冷/热各一次 |
| **官方文档** | [pnpm Settings](https://pnpm.io/settings)、[What's different in pnpm 12](https://pnpm.io/blog/whats-different-in-pnpm-12)、[pnpm 12.0 发布说明](https://pnpm.io/blog/releases/12.0)、[Mitigating supply chain attacks](https://pnpm.io/supply-chain-security) |

> **未验证项（诚实标注）**：① `.npmrc` 的 `strict-peer-dependencies` / `engine-strict` / `save-exact` **是否真的失效未实测**（仅据官方"只有 auth/registry 从 .npmrc 读取"推断）；② CI 冷缓存下供应链校验的真实耗时（本机 34.4s，含两次慢速 registry 请求）；③ Phase 1b 会暴露多少幻影依赖——**无法预估，Phase 0.3 是答案**；④ `allowBuilds` 清空后哪些包真正必须加回——预判见 1c 表格，仍需实测。
