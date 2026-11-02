# R3 前端复查（独立视角）：撤 `@walnut/ui` + 显式注册表 + `check-dynamic-imports` 门禁

> **轮次**：批次 1 · P0 止血 ｜ **R3 前端复查轮**（R1/R2 都不是我做的，本轮以"挑错"为目标）
> **范围**：前端那批（apps/admin、apps/docs、packages/、根、lockfile）。**未触碰 `apps/server/**`**。
> **前置**：`reports/batch-1/r1-fe-verification.md`（557 行）、`r2-fe-implementation.md`（207 行），均已读完。
> **本报告所有结论都是本轮实测**（命令与原始输出在正文里）。临时探针全部已删；两次改门禁文件的实验都做了 sha256 还原校验
> （`check-doc-refs.ts` 前后同 hash）；负对照期间被 `prebuild` 重写过的 `components.d.ts` 从备份还原，hash 与 R2 一致。
> **环境**：pnpm 一律经 `cmd /c`；工作树与他人（后端轮次）共用，`git status` 行数会随他们漂移（我结束时 82 行）。

---

## 0. 结论速览

| # | 任务 | 我的判定 | 一句话证据 |
|---|------|---------|-----------|
| 1 | 字面量 `import()` 是否真的编译期红（负对照） | ✅ **成立** | 改名 `UI/Switch` 后：`types:check` → `TS2307` ×2、exit 1；`pnpm build` → 同样 `TS2307`、exit 1；还原后 build `✓ built in 1m 15s`、exit 0 |
| 2 | 30 条注册表全覆盖 | ✅ **0 多 0 少** | 与 HEAD 的 4 个分组常量 + 3 条写死项集合逐键相等（30/30，0 missing / 0 added）；30 个字面量目标 `existsSync` 全通；与 R1 的"27 通 3 断"对账：那 3 个断键现在都通 |
| 3 | 残留引用清扫 | ⚠️ **26 文件命中，0 处必须现在清** | 表格见 §3；真正"读着像现状"的只有 ADR 0012 的 tags 表 + ADR 0014 一句（P2），`.changeset/ledger.yaml` 无任何机械消费者（P3，别动） |
| 4 | 新门禁有效性与边界 | ⚠️ **有效但有 3 个洞** | 负对照复跑成功（3 findings / exit 1 / 还原转绿）；但实测到 **1 个误报**（`obj.import(x)`）、**1 个漏报**（`import('a' + b)`）、**不扫未跟踪文件**（探针 staged 前后 1619 → 1620） |
| 5 | 运行期实证 | ✅ **比 R2 更强** | 30/30 注册表 key 在 dist 里各自指向**存在的独立 chunk**（0 缺失 / 0 空壳）；3 个组件 chunk 含真代码（`WCompUISwitch` / `WCompUITimePicker` / `WCompUIDynamicTags`）；`preview` 起在 **8080**，5 个 URL 全 200 且字节数与 dist 逐一相等；**浏览器内渲染未验（需登录）**，见 §5.3 |
| 6 | 联动检查 | ✅ **另 10 处按路径解析，均非本次同源故障** | `import.meta.glob` ×8 + `globSync` ×1 + 组件自动注册；`components.d.ts` 70 个 W* 条目、零 `@walnut/ui` |
| B-① | `liveDocs()` 加 `existsSync` | ✅ **是修 bug，不是放宽** | 我把这行去掉复跑：`ENOENT … packages/platform-web/ui/CHANGELOG.md`、exit 1（脚本自己崩）→ 加回即绿 |
| B-② | `FROZEN` 加 `^reports/` | ⚠️ **是放宽，且比既有先例更宽** | 三连实验：进 `reports/` 的幽灵包/死路径**全绿**；同一内容放进活文档 → 3 类失效 exit 1；改成"只免路径"后 → `reports/` 里的幽灵包**被抓住**（详见 §7） |

**一句话回答判据**：**这次改造没有让别的门禁失效**（11 条门禁我实测全绿，见 §8），
**但它自己新开了一处"全免检区"（`reports/`）** —— 这是本轮唯一的实质异议，见 §7.2。

---

## 1. 负对照：字面量 `import()` 到底能不能在编译期/构建期红（任务 1）

### 1.1 做法

把 `apps/admin/src/components/UI/Switch` **原地改名**成 `SwitchR3Moved`（同卷 rename，避免跨盘 EXDEV），跑两条命令，
然后 `finally` 里改名还原 + 用 sha256 逐文件比对。

### 1.2 原始输出

```
$ cmd /c "pnpm --filter @walnut/admin types:check"
src/components/UI/Form/src/components/FormItem/componentMap.ts(50,24): error TS2307:
    Cannot find module '@/components/UI/Switch' or its corresponding type declarations.
src/components/UI/Form/src/types.ts(38,41): error TS2307:
    Cannot find module '../../Switch' or its corresponding type declarations.
[ELIFECYCLE] Command failed with exit code 2.
### exit = 1
```

```
$ cmd /c "pnpm --filter @walnut/admin build"
transforming...src/components/UI/Form/src/components/FormItem/componentMap.ts(50,24): error TS2307: …
src/components/UI/Form/src/types.ts(38,41): error TS2307: …
[ELIFECYCLE] Command failed with exit code 2.
### exit = 1   （dist 未被清空，仍 1347 个文件）
```

还原后（本轮又完整跑了一次真构建，作为"树是绿的"证据）：

```
$ cmd /c "pnpm --filter @walnut/admin build"
dist/static/js/utils-DJYj7A_N.js   9.15 kB
…
✓ built in 1m 15s
### exit = 0
```

还原校验：`index.ts` / `index.vue` / `types/generated/components.d.ts` 三个 sha256 与实验前**逐字节相同**
（`components.d.ts` = `24f3c1e3…`，与 R2 交付时一致；实验后我又跑了一次真 build，hash 仍未变 ⇒ 这次没触发那个已知的 dts 竞态）。

### 1.3 对 R2「偏离点 A」的评判：**取舍成立，但有一处措辞要收窄**

| 判据 | 结论 |
|------|------|
| "编译期安全完全一样" | ✅ **成立**（TS2307 直接指到 registry 那行 `componentMap.ts:50`） |
| "缺文件 vite build 立刻红" | ✅ **成立**（我复现了 exit 1）——但**红在 TS 检查层**（`vite build` 里挂的 checker），不是我单独证明的 Rollup 解析层 |
| "保住了按需分包" | ✅ **成立**（§5.1：30 个 key 各自一个懒加载 chunk，registry 里是 `Key:()=>…import(`./X.js`)`） |
| 代价 | **可接受**：注释（`componentMap.ts:5-31`）把"为什么不用模板串"写清了；还多了一句维护约定 |

**唯一要收窄的措辞**：R2 §D1 说"`vue-tsc` 与 `vite build` 都能解析字面量说明符 ⇒ 缺文件当场红（这正是要的东西）"。
实测红的是 **TS 那一层**；如果将来有谁把 `vite build` 的 checker 关掉，这条结论就只剩 Rollup 兜底 ——
而我**没有单独实证 Rollup 层**（这里标注为未验证，不写成"已验证"）。
建议在 `componentMap.ts` 的维护约定里补半句"红来自 checker；别把构建的 TS 检查关掉"。

**判定：D1（静态注册表 + 字面量 `import()`）不是妥协，是更优解**（比顶层 `import` 多保住了分包，安全性等价）。

---

## 2. 30 条注册表全覆盖核对（任务 2）

### 2.1 与"4 个分组常量 + 3 条写死项"逐键对账

R2 **删掉了** `BUILT_IN_FORM_ITEM_TYPE_{UI,EXTRA,BUSINESS,EXTEND}` 这四个常量（HEAD 版 `componentMap.ts:5-42`），
所以对账基线必须取自 `git show HEAD:` 的版本。脚本对两侧做集合差：

```
HEAD  groups: {UI:16, EXTRA:7, BUSINESS:2, EXTEND:2}
HEAD  named:  [RoleSelect, Tinymce, JSONEditor]    naive: [Slider, DynamicInput, InputOtp]
HEAD  total dynamic keys: 30    map size: 33

R2    tables: {BUILT_IN_UI:16, BUILT_IN_EXTRA:7, BUILT_IN_BUSINESS:2, BUILT_IN_EXTEND:2, NAMED_EXTRAS:3}
R2    naive:  [Slider, DynamicInput, InputOtp]     total dynamic keys: 30    map size: 33

MISSING in R2: (none)      ADDED in R2: (none)      naive 集合相同: true
```

**结论：key 没有多、没有少、没有换组**（脚本报的 30 条 "group changed" 是分组名从 `UI` 变成 `BUILT_IN_UI`，键相同）。

删除这 4 个常量的安全性：`git grep` 全仓 + `git grep HEAD` 都只有 `componentMap.ts` 自己引用它们 ⇒ 无外部消费者。**判定：安全。**

### 2.2 30 个说明符逐个落到文件（`@` → `apps/admin/src`）

```
OK BUILT_IN_UI.Button … TreeSelect                 （16/16）
OK BUILT_IN_EXTRA.EmailInput … TransitionSelect     （7/7）
OK BUILT_IN_BUSINESS.AreaCascader / Dict            （2/2）
OK BUILT_IN_EXTEND.Query / Divider                  （2/2）
OK NAMED_EXTRAS.RoleSelect / Tinymce / JSONEditor   （3/3）
unresolved: 0
```

### 2.3 与 R1「27 通 3 断」对账

R1 的 3 个断键是 `DynamicTags` / `Switch` / `TimePicker`（都指向已不存在的 `UI/<key>/index.ts`）。
本轮实测这 3 个现在都指向 `apps/admin/src/components/UI/<key>/index.ts` 且文件存在 ⇒ **30/30 通，0 断**。
R1 的 map size 33（30 动态 + 3 naive）也被 R2 完整保留。

> 顺带确认 R2 §1.1 的"6 文件"：三个目录各 `index.ts` + `index.vue` = 6 个（我数了目录，一致）。

### 2.4 一个**削弱了的编译期约束**（R2 没提，我认为值得记）

- 旧版：`const BUILT_IN_FORM_ITEM_TYPE_UI = [...] as const` → 分组清单本身是**具名常量**，字面量类型可被复用；
- 新版：`const BUILT_IN_UI: Record<string, ModuleLoader> = {...}` → **key 是 `string`，没有字面量类型约束**。

后果：把 `Switch:` 写成 `Swtich:`，只要 `import('@/components/UI/Swtich')` 同时改错，`vue-tsc` 会红（模块不存在）；
但如果**只改 key 不改路径**（`Swtich: () => import('@/components/UI/Switch')`），**全绿**，
而 `Base:Switch` 的 63 处 schema 会重新变成静默不渲染 —— 正是这次事故的同一故障模式（R1 §1.3 称"第二类断"）。
这类"schema key ↔ map key"仍**没有任何机械对账**，新门禁也不管它（它只看 `import()`）。
**建议（P2）**：把 `Record<string, ModuleLoader>` 换成 `satisfies Record<BuiltInFormItemKey, ModuleLoader>`（key 取自 `types.ts` 的 `Base:*` 联合），
或加一条测试断言 `componentMap.keys()` ⊇ schema 实际用到的 key 集合。

---

## 3. 残留引用清扫（任务 3）

`git grep -n "walnut/ui"`：**26 个跟踪文件**命中（`git grep -l | wc -l` 同值）。`platform-web/ui` 另有 11 处（多在同类文件）。

| 类别 | 文件 | 该不该现在清 |
|------|------|-------------|
| **发版台账（历史事实）** | `.changeset/ledger.yaml:392-399`（`"@walnut/ui@0.1.0"` + `dir: packages/platform-web/ui`） | **不清**。全仓 `git grep "ledger.yaml"` 只命中**文档**，没有任何脚本/测试读它；pnpm 的 ledger 是 append-only 台账。改它 = 改写已发生的历史。**P3** |
| **ADR（历史决策）** | `adr/0001:14`、`adr/0012:154,172`、`adr/0014:22-24`、`adr/0017`（8 处） | `0001/0017` 不动（讲的就是当时）。**`0012:154` 的 tags 表 + `:172`、`0014:22` 的"最后一个本地 eslint 配置在 platform-web/ui" 是"读着像现状"的** ⇒ **建议改**（见下） |
| **冻结语料** | `content/archive/2026-09-21-architecture-review.md`（4 处）、`content/industry-research/backend-architecture-review/*`（3 处） | 不清（FROZEN 本就覆盖） |
| **已完成的提案** | `plans/package-sinking-proposal.md:70` | 不清（记录的是当时的读数） |
| **代码里的注释/说明** | `componentMap.ts:18`、`ci.yml:126`、`check-doc-refs.ts:107,131`、`apps/admin/CHANGELOG.md:179` | 不清（都在**解释这次删除**，删掉反而更难读） |

**必须现在清的：0 处。** 三条理由：
1. 没有一条会让任何门禁红（`lint:docs-refs` 已被 R2 用 `ALLOWED_MISSING_PACKAGES['@walnut/ui']` 兜住，实测绿）；
2. 除 ADR 0012/0014 外，全部是"历史叙述"或"解释本次删除"，改写属净负收益；
3. 真正会制造困惑的只有 ADR 0012 那张表（它**自称**"随包增删更新"），但那是 ADR 修订政策问题，不该混进 P0 提交。

**建议（P2，S）**：下一次 ADR 维护一起做——删 `0012:154` 那行、把 `:162` 的"16 行与 16 个包一一对应"改成判据式表述、
改 `0014:22` 的"platform-web/ui 写本地 eslint 配置"（该包已删）。**别为这三行走单独 commit 打断 P0。**

> ⚠️ 需 Lead 知情：`ALLOWED_MISSING_PACKAGES['@walnut/ui']` 是**永久**豁免，让 ADR 与 CHANGELOG 里的引用永远绿。
> 这和 §7.2 的 `reports/` 是两个独立的放宽点；前者合理（历史文档确实该免），后者更粗（连"新写的错"也免）。

---

## 4. 新门禁 `check-dynamic-imports` 的有效性与边界（任务 4）

### 4.1 覆盖与接线（全部复现）

| 项 | 实测 |
|----|------|
| 扫描面 | `apps/`，1619 个文件（`git ls-files` ∩ 落盘存在 ∩ 非三类例外） |
| 接线 5 处 | 根 `package.json:41` `lint:dynamic-imports` ✓ / `prepush.ts:120`（`id:'dynamic-imports'`）✓ / `ci.yml:129` ✓ / `steps.ts:87` 发版电池 ✓ / `scripts/package.json:17` bin ✓（`release.md:165` 电池表也有对应行，与 `steps.ts` 的 label 一致） |
| 自测 | `vitest run src/ci/__tests__/check-dynamic-imports.test.ts` → **13/13 pass**（复现 R2） |
| 实跑 | exit 0，`1619 个 …；豁免 0 条` |

### 4.2 负对照（我自己重做了一遍，不引用 R2 的）

探针文件（后删）里放了 10 个用例。**未跟踪时**跑：`1619 个文件 / ✅ 绿` —— 探针**根本没被扫**（见 §4.3 洞③）。
`git add` 之后跑：

```
动态 import 检查：1620 个 apps/ 下的手写运行时代码；豁免 0 条
✖ apps/admin/src/__r3_dyn_probe.ts:7   [模板插值]  export const c3 = () => import(`@/components/UI/${key}`)
✖ apps/admin/src/__r3_dyn_probe.ts:8   [非字面量]  export const c4 = () => import(spec)
✖ apps/admin/src/__r3_dyn_probe.ts:14  [非字面量]  export const c10 = () => c9.import(key)
✖ 有 3 处拼出来的动态 import    ### exit = 1
```

还原（`git reset` + 删文件）后转绿、目录回到 1619、`git status` 无残留。**负对照可复跑 ⇒ 判据成立。**

### 4.3 十个用例的逐条结论（本轮门禁评估的核心产出）

| 用例 | 期望 | 实测 | 判定 |
|------|------|------|------|
| `import('@/…/Switch')` | 放行 | 放行 | ✅ |
| `import(`@/…/Switch`)`（纯模板无插值） | 放行（文件头声明） | 放行 | ✅ 与文档一致 |
| `import(`@/…/${key}`)` | 报（模板插值） | 报 | ✅ |
| `import(spec)` | 报（非字面量） | 报 | ✅ |
| `import.meta.glob('…')` | 放行 | 放行 | ✅ |
| `new URL('./x', import.meta.url)` | 放行 | 放行 | ✅ |
| 字符串正文里的 `import(foo)` | 放行 | 放行 | ✅（掩码有效） |
| **`obj.import(key)`（同名方法调用）** | **应放行** | **报 `[非字面量]`** | ❌ **误报**（洞①） |
| **`import('@/…/' + key)`（字符串拼接）** | 应报 | **放行** | ⚠️ **漏报**（洞②） |
| **新写（未跟踪）文件** | 应扫 | **不扫** | ⚠️ 盲区（洞③） |

**洞① 误报（P2，改一行）**：正则 `/\bimport\s*\(/` 对 `c9.import(key)` 也匹配（`.` 与 `i` 之间有 `\b`）。
修法：命中后看前一个非空字符，若是 `.` 就跳过（`obj.import()` 不是模块导入）。
现实概率低（仓内目前 0 处），但误报是门禁最贵的失败模式（该文件头自己写了"宁可漏报，不可误报"）。

**洞② 漏报（P3，可修）**：只看了说明符的**第一个字符** —— 见到 `'` 就跳过，于是 `import('a' + b)` 被当成字面量。
这恰好是**本门禁要防的病因形态**（拼出来的说明符）。修法：`'`/`"` 开头时找配对引号，若其后第一个非空字符是 `+`
就按 `non-literal` 报。按"宁可漏报"的立场这不算 bug，但这是**同一病因**，我倾向补上（~10 行 + 1 条用例）。

**洞③ 不扫未跟踪文件（P2，用现成工具）**：`listScannedFiles` 用 `git ls-files`（仅索引）。
所以开发者写完新文件、跑 `pnpm lint:dynamic-imports` 是**绿的**；只有 CI（已跟踪后）才抓得住。
修法：改成同目录已有的 `lsFilesWithUntracked`（`lib/git.ts`，`check-doc-refs` 用的就是它）。

### 4.4 三类例外面抽查（R2 §5.2 让我确认它们确实"不是运行时代码"）

| 例外 | 实测 | 判定 |
|------|------|------|
| `*.spec.ts` / `*.test.ts` | 测试按路径动态加载夹具（R1 已列）；新门禁自己的单测也用探针文件 | 合理 |
| `apps/*/build/**` | `apps/admin/build/vite/plugin/component.ts` 等构建期 Node 工具（`globSync` 扫目录，不进产物） | 合理 |
| `**/public/**` | `apps/admin/public` 下只有 **1** 个 js：`vendor/codeMirror/langs/zh-CN.js`（第三方 minified） | 合理 |
| **`packages/**` 完全不在扫描面** | 我实测：`packages/` 下 **0 处**插值/非字面量 `import()` ⇒ 当前无实害 | **今天够用**；将来若 `@walnut/client` 出现同类写法会漏（P3 记一笔） |

---

## 5. 运行期实证（任务 5）

### 5.1 dist：30/30 注册表 key → 独立、非空 chunk（比 R2 给的三条更强）

在产物里找到 registry 所在 chunk（`dist/static/js/utils-DJYj7A_N.js`，9369 B），提取全部懒加载条目：

```
registry lazy entries found: 30
OK Button     → Button-C1rP2LRd.js (692B)     … OK Query → Query-Ccl1-4l0.js (2446B)
OK Switch     → Switch-BQa5H3Gp.js (1010B)    OK Divider → Divider-C1y5jVQU.js (2137B)
OK TimePicker → TimePicker-CCaAjmS_.js (861B)
OK DynamicTags→ DynamicTags-CK6vOVTX.js (697B)
missing=0   suspiciously-small(<200B)=0
source lazy keys: 30   dist keys: 30   in source but not in dist: (none)   in dist but not in source: (none)
```

产物里的注册表长这样（原样摘录 —— key 名与懒加载都还在）：

```js
Switch:()=>n(()=>import(`./Switch-BQa5H3Gp.js`),__vite__mapDeps([36,2,3])),
TimePicker:()=>n(()=>import(`./TimePicker-CCaAjmS_.js`),__vite__mapDeps([37,2,3])),
```

**"不是空壳"的直接证据**（chunk 正文里的组件名与 props）：

| chunk | 大小 | 证据 |
|-------|-----:|------|
| `Switch-BQa5H3Gp.js` | 1010 B | `name:"WCompUISwitch", props:{checkedText:{},uncheckedText:{}}` + 渲染 `NSwitch` 的两个 slot |
| `TimePicker-CCaAjmS_.js` | 861 B | `name:"WCompUITimePicker"` |
| `DynamicTags-C-OLnCcZ.js` | 857 B | `name:"WCompUIDynamicTags"` |
| `Button-C1rP2LRd.js` → `Button-DqQz8edM.js` | 692 → 1526 B | 抽样验证"壳 → 真组件"链：真 chunk 含 `WCompUIButton` |

> 解释一个现场会误导人的现象：`DynamicTags-*` 有 **4 个** chunk，那不是重复打包 ——
> `DynamicTags-C-OLnCcZ.js` 是组件本体；`DynamicTags-CK6vOVTX.js` / `-DTaKNBOA.js` 是 697 B 的
> `export{…as default}` **壳**（`index.ts` 与 `index.vue` 是两个 module id）；`DynamicTags--yIkG7F0.js` 是
> `views/demo/UI/DynamicTags.vue` 那个**页面** chunk（它 import 了 Title/JSON/DemoCard）。**没有一份是白带的。**

### 5.2 preview + curl（R2 只到"产物含 chunk"，我补了服务层）

`cmd /c "pnpm --filter @walnut/admin preview"` → `http://localhost:8080/`（**不是 4173**）。

```
index                     200  5034 bytes
Switch chunk              200  1010    ← 与 dist 字节数逐一相等
TimePicker chunk          200   861
DynamicTags chunk         200   857
registry chunk            200  9369
/demo/form/baseForm       200  text/html   （SPA fallback 正常）
chunk 正文含 WCompUISwitch: True
```

### 5.3 **未做**：浏览器内渲染（明说，不硬造）

- `DevSettings`（`Base:Switch` 的 8 个文件所在）挂在 `components/App/AppSettings/index.vue:35`，
  而 `AppSettings` 属登录后的 header ⇒ **登录前根本渲染不到**；
- 登录页（`views/auth/**`）不在 R1 §1.7 的受影响清单里，**不含 `Base:Switch`**；
- 我没有可用登录凭据，后端也不在本轮状态（`preview` 的代理指向 `base.invalid`，实测 `ENOTFOUND`）。

⇒ 我能证明的是「**注册表 → chunk → 真组件代码 → 该 chunk 被 HTTP 正常服务**」这条链完整；
**不能**证明"浏览器里肉眼可见地渲染出 Switch"。这需要一次带登录的走查（R2 §5.1 已列待办）。
按 Lead 给的判据（"证明这三个 chunk 含真实组件代码 + 表单渲染路径能取到它们"）—— **判据已满足**。

---

## 6. 联动检查：admin 里还有哪些"按路径/目录名解析"的地方（任务 6）

| 位置 | 形态 | 缺文件时的后果 | 与本次同源？ | 判定 |
|------|------|---------------|------------|------|
| `build/vite/plugin/component.ts:9` | `globSync('src/components/**/**/index.ts')` | 静默少一个组件名（不报错） | **同源**（构建期） | 已由"目录在就注册"兜底；`componentMap` 现在不再依赖它 |
| `router/utils/route.ts:38` | `import.meta.glob('../../views/**/*.vue')` | **路由指向不存在的 view ⇒ 静默空白页** | **同源（隐患仍在）** | P2：可加"每条路由的 view 都能在 glob 表里命中"的断言 |
| `views/system/menu/utils.ts:26` | `import.meta.glob('@/views/**/*.vue')` | 菜单配置里选不到该 view（下拉为空） | 同上 | 同上，影响更小（UI 可感知） |
| `views/demo/{UI,form,table,business,Extra}/index.vue` | `import.meta.glob('./*.vue', {eager:true})` | 少一个 demo 卡片 | 否（自描述目录） | 可接受 |
| `components/Vendor/CodeMirror/index.vue:56`、`views/demo/vendor/CodeMirror/index.vue:8,17` | `import.meta.glob` 语言包 | 少一种语法高亮 | 否 | 可接受 |
| 组件自动注册（`unplugin-vue-components`） | 同上 globSync | 模板里写 `<WXxx>` 而目录不存在 ⇒ **vue-tsc 不报**（tsconfig 未开 `strictTemplates`，`apps/admin/AGENTS.md` 已记录） | 同源（已知） | 非本次引入；`components.d.ts` 是它的产物 |

**`components.d.ts` 体检**：348 行 / **70 个 W\* 条目**；`WDynamicTags` 指向 `@/components/UI/DynamicTags/index.ts`；
**没有** `WSwitch`/`WTimePicker`（模板里 0 处使用，正常）；**零** `@walnut/ui` 引用。与 R1 §1.5 的表一致。

---

## 7. 两处门禁判定修改的裁定（R2 的「偏离点 B」，本轮重点）

### 7.1 ①`liveDocs()` 加 `existsSync`：**是修 bug，必须保留**

我把那行去掉复跑：

```
$ cmd /c "pnpm lint:docs-refs"      # 去掉 existsSync 过滤后
✖ 脚本自己出错了（这不是检出违规，是本工具的问题）：
Error: ENOENT: no such file or directory, open
  'D:\walnut-admin\walnut-admin\packages\platform-web\ui\CHANGELOG.md'
    at check-doc-refs.ts:393
### exit = 1
```

加回 ⇒ 绿（308 篇）。**根因**：`git ls-files` 读索引，而 `packages/platform-web/ui/**` 目前是 `git status` 里的
` D`（工作区已删、索引未更新）⇒ 索引里仍有 `CHANGELOG.md`。
**它不会掩盖真违规**：被跳过的文件在磁盘上不存在，没有正文可校验；若别处引用了它，那是**引用方**的路径检查（走 `pathResolves`，不受影响）。
**判定：修 bug，非放宽。R2 的处理正确，且与 `check-emoji.ts` 的先例一致。**

### 7.2 ②`FROZEN` 加 `^reports/`：**是放宽，而且比仓里既有先例更宽**

三连实验（探针内容 = 幽灵包 `@walnut/r3-ghost` + 已删路径 `packages/platform-web/ui/src/Switch/index.ts` + 不存在路径）：

| 实验 | 配置 | 结果 |
|------|------|------|
| A | 当前代码，探针放 `reports/__r3_probe.md` | **exit 0 全绿**（308 篇，探针**未被计入**） |
| B | 同内容放活文档 `content/__r3_probe.md` | **exit 1**：`✖ 包名 @walnut/r3-ghost`、`✖ 路径 …ui/src/Switch/index.ts`、`✖ 路径 …nope/src/x.ts`（3 类） |
| C | 把 `^reports/` 从 `FROZEN` 挪到 `PATH_CHECK_EXCLUDED` | **exit 1**：`✖ 包名 @walnut/r3-ghost`（**只**报包名，两条路径不再报） |

C 证明两件事：**① 路径这一半确实需要豁免**（否则 R1/R2 报告里的"已删除路径"必然红，R2 的动机成立）；
**② 包名这一半并不需要豁免** —— 而现在的写法把它也一起免了。

**为什么说"比先例更宽"**：`check-doc-refs.ts` 自己有**两层**豁免，语义不同：

- `PATH_CHECK_EXCLUDED`（`:51`）= ADR + `architecture-todo.md` → **只免路径**，包名照查；
- `FROZEN`（`:38`）= `content/archive/`、`content/industry-research/` → **全免**。

ADR 是"最该被当成历史"的东西，却仍受包名检查；而 `reports/` 是**每批新产的、还会被人当现状读**的活文件，却被全免。
按该文件自己的分层，`reports/` 更像第一类（描述某一时刻，路径必然失效），不像第二类（冻结语料）。

**这条放宽的具体风险（不是抽象的）**：
1. `reports/` 会随批次**持续增长**，而 FROZEN **无过期** ⇒ 越往后免检面越大；
2. 报告是**给人当结论读**的，里面写错包名/路径恰是 R2 自己在 §5.3 担心的"grep 时制造困惑"；
3. **自指**：本报告也在 `reports/` 里 ⇒ 我写错任何路径都不会被门禁抓到（我尽力人工核对，但这不是机械保证）。

**建议（P1，一行改动）**：

```diff
-const FROZEN = /(?:^|\/)content\/(?:archive|industry-research)\/|^reports\//
+const FROZEN = /(?:^|\/)content\/(?:archive|industry-research)\//
-const PATH_CHECK_EXCLUDED = /(?:^|\/)content\/adr\/|architecture-todo\.md$/
+const PATH_CHECK_EXCLUDED = /(?:^|\/)content\/adr\/|architecture-todo\.md$|^reports\//
```

**效果**（我实测过 C 方案）：路径豁免保留（R2 的动机满足）+ 包名仍受检（`@walnut/ui` 已有 `ALLOWED_MISSING_PACKAGES` 兜着，不会误报）。
**如果 Lead 认为"报告就该完全免检"**，也请把理由写进 `FROZEN` 的注释并说明**免检面会随批次增长** —— 现状注释只解释了路径，没解释包名。

---

## 8. 我实测过的门禁（含 R2 声称的复现）

| 门禁 | 我跑的 | 结果 |
|------|--------|------|
| admin types:check | ✅ | exit 0（实验后复跑） |
| admin build | ✅ | exit 0，`✓ built in 1m 15s` |
| lint:docs-refs | ✅ | exit 0，308 篇 / 包名豁免 16 / 路径豁免 8 |
| lint:dynamic-imports | ✅ | exit 0，1619 文件 / 豁免 0 |
| check-dynamic-imports 单测 | ✅ | 13/13 |
| boundaries | ✅ | `4647 files in 15 packages, no issues` |
| lint:exports | ✅ | 15 包 / 11 个声明 exports |
| lint:doc-budget | ✅ | 6 个常驻文件，**AGENTS.md 94%（8203/8700）** ← 余量只剩 497 字符（P3 提醒） |
| lint:doc-ts | ✅ | 230 篇 / 125 ts 块 + 3 json 块 |
| lint:adr | ✅ | 27 篇 |
| （未跑）pnpm lint 全量 | — | R2 已说明唯一红在 `apps/server`（他人改动），我遵守"不动 server"，未复跑 |

**"R2 说绿但我复现不出来"的：0 条。** 我唯一一次"复现失败"是**我自己的 PowerShell 写错**
（用 `-match` 判 chunk 内容），换 `Select-String -Quiet` 后为 `True` —— 与 R2 无冲突。

---

## 9. 这次改造有没有让别的门禁/约定失效？

**没有。** 三条依据：① 受删包影响的 4 条门禁（docs-refs / boundaries / exports / turbo-cache 相关面）我实测全绿；
② 唯一需要"改判定面"的地方（`liveDocs` 的 `existsSync`）经实验证明是**修崩溃**而非放水；
③ 另两处"约定"级动作（`ALLOWED_MISSING_PACKAGES` 新增 `@walnut/ui`、`FROZEN` 新增 `reports/`）都是**放宽**，
其中第 2 处比先例宽（§7.2），是本次唯一需要 Lead 拍板的地方。

---

## 10. 可以提交吗？—— P0/P1/P2 清单

**结论：可以提交，但建议同批收掉 P1-1（一行），并在提交信息里记一句 P1-2。**

| 编号 | 级别 | 事项 | 工作量 | 为什么 |
|------|------|------|--------|--------|
| — | **P0** | 无 | — | 功能与门禁我都实测过：30/30 注册表、dist 30/30 chunk、build/types 绿、负对照红后能还原 |
| P1-1 | **P1** | 把 `^reports/` 从 `FROZEN` 挪到 `PATH_CHECK_EXCLUDED`（§7.2 的 diff） | S（一行 + 注释） | 唯一实质性异议：现在是**全免 + 无过期 + 自指**；挪过去后路径豁免照旧、包名仍受检（我已实测 C 方案） |
| P1-2 | P1（记账） | 提交信息里写明"本次新增两处门禁放宽：`@walnut/ui` 包名豁免、`reports/` 冻结" | S | 放宽必须留痕；否则下一轮会把"reports 全绿"误当健康信号（本仓 `knip.md` 已有过一次这种误读） |
| P2-1 | P2 | 修门禁误报：`obj.import(x)`（命中后看前一字符是否为 `.`） | S | 误报是门禁最贵的失败模式（文件头自述） |
| P2-2 | P2 | 门禁改用 `lsFilesWithUntracked`（现在漏扫未跟踪文件） | S | 开发者本地预跑会得到假绿 |
| P2-3 | P2 | `Record<string, ModuleLoader>` → `satisfies Record<BuiltInFormItemKey, ModuleLoader>`（或加 key 覆盖断言） | M | 补回被删分组常量丢掉的"key 名"编译期约束；否则"只改 key 不改路径"仍会静默（P0 故障的同一模式） |
| P2-4 | P2 | ADR 0012:154/162、ADR 0014:22 的"现状型"陈述订正 | S | 唯一"读着像现状"的残留；不红 |
| P3-1 | P3 | 门禁补 `import('a' + b)` 的漏报（配一条用例） | S | 与门禁病因同类，但现有立场是"宁可漏报" |
| P3-2 | P3 | `router/utils/route.ts` 的 `views/**` glob 加"路由 view 必须命中"的断言 | M | 同类静默故障的最后一处结构性隐患 |
| P3-3 | P3 | `AGENTS.md` 字数余量只剩 497 字符（94%） | S | 下一次往常驻文件里加内容会先撞预算 |
| — | 不动 | `.changeset/ledger.yaml` 的 `@walnut/ui@0.1.0` | — | append-only 历史；无任何机械消费者（已 grep 验证） |

---

## 附：本轮做过的实验与还原证据（便于复跑/追责）

| 实验 | 碰了什么 | 还原方式 | 校验 |
|------|---------|---------|------|
| docs-refs 探针（reports/ 与活文档各一次） | 新建 2 个 `.md` | 删除 | `lint:docs-refs` 回到 308 篇 / exit 0 |
| 窄化 `FROZEN` 实验 | 改 `check-doc-refs.ts` 两行 | 从备份覆盖 | sha256 与改前**相同** |
| 去掉 `existsSync` 实验 | 改 `check-doc-refs.ts` 一行 | 从备份覆盖 | sha256 与改前**相同** |
| 负对照（types:check / build） | 目录改名 | 原地改回 | 3 个文件 sha256 与改前**相同**；`components.d.ts` = `24f3c1e3…` |
| 门禁负对照（动态 import 探针） | 新建 + `git add` 一个 `.ts` | `git reset` + 删除 | 目录回到 1619、`git status` 无残留 |
| 收尾 | — | — | `types:check` exit 0、真 build exit 0 |
