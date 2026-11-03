# 10 · 实施计划（P0/P1 · 5 批 × 3 轮）

> 编制：**2026-11-02**｜依据：本目录 00–09 六份调研 + 6 条已定决策（见 [07](./07-decisions.md)）
> 执行方式：**每批 3 轮、每轮派 Agent**
> - **R1 复核**：确认问题真实存在、量化影响面、给出验证手段（只读）
> - **R2 实施**：按 R1 结论动手（写）
> - **R3 复查**：验证 + **联动影响排查**（改造后新增的隐式依赖、被遗漏的调用方、门禁是否真的生效）（只读 + 补测试）

---

## 一、现状核验（2026-11-02 复核，工作树已 clean @ 30a92dc8）

| ID | 断言 | 状态 | 复核证据 |
|----|------|------|---------|
| P0-1 | componentMap 按目录名拼路径动态 import | **成立** | componentMap.ts 命中 4 处模板串 import |
| P0-2 | @walnut/ui 包仍存在 | **成立** | packages/platform-web/ui/src 7 个文件 |
| P0-3 | admin 已无 Switch 目录 | **成立** | Test-Path 三个目录均 False |
| P0-4 | Base:Switch 使用面 | **成立** | git grep 计数 = **73 处** |
| P1-1 | 算子按「值的 JS 类型」选 | **成立** | pg-list.builder.ts 3 处 typeof value |
| P1-2 | 可选槽位不下钻校验 | **成立** | object.validator.ts required===false → Allow() |
| P1-3 | pageSize 无上限 | **成立** | builder 内 clamp / Math.min 命中 0 |
| P1-4 | knip 把 barrel 当 entry | **成立** | knip.config.ts 命中 5 个包条目 |
| P1-5 | turbo 缺 frontend tag 规则 | **成立** | turbo.json 命中 0（platform-node 规则有，但其唯一 subject 是 apps/server） |
| P0-5 | worker 无生产面 | **成立** | Dockerfile 只有 api CMD；deploy/+CI 对 worker 的命中全是 nginx worker_processes |
| P1-6 | seed 仍是 Mongo EJSON | **成立** | $oid 4416 行 |
| P1-7 | platform-web 桶入口仍在 | **成立** | client/src/index.ts、http/src/index.ts 存在 |
| P1-8 | zod ADR 已过期 | **成立** | 命中「自定义 Pipe」「0 使用」 |
| P1-9 | @walnut/types 标签是 any | **成立** | package.json platform 字段为 any |
| D-1 | 评审文档编码 | **已修复** | 迁入 docs 时 5 个文件被写成非 UTF-8；已从 30cefe2d 按字节还原为 UTF-8 |

**结论：13 条技术问题全部成立，无一自愈。** 另有 1 条文档编码问题已就地修好。

---

## 二、优先级定义

| 级别 | 判据 | 本仓当前 |
|------|------|---------|
| **P0** | 已在生产路径上产出错误行为（500 / 运行时断裂），或安全/数据正确性受影响 | 表单注册表断裂（73 处）、list 3 类必现 500 + 校验失效 |
| **P1** | 不直接出错，但**门禁失效 / 边界失真 / 契约污染**，会让 P0 类问题反复发生 | 门禁三件、注册面、platform-node、wire 契约、worker 生产面、packages 收拾 |
| **P2** | 结构债与数据卫生，改动面大但可延后 | libs 合并、锁端口化、cache 域缓存、seed 重建、命名 |

---

## 三、批次与轮次

### 批次 1 · P0 止血

**目标**：消掉两个已在生产路径上的错误行为。**唯一允许跳过额外审批直接开工的批次。**

| 轮 | Agent | 任务 | 产物 |
|----|-------|------|------|
| R1 | b1-r1-fe | 复核 P0-1..P0-4：按 componentMap 的 4 个 getXxxComponents() 逐个枚举 BUILT_IN_FORM_ITEM_TYPE_* 全量 key，**逐个**核对解析目标是否存在；列出真实断掉的 key（不止 Switch/DynamicTags/TimePicker）；给出「运行时断言」的具体写法；评估删 @walnut/ui 的连锁面（build 插件、Form 类型 import、docs 侧边栏、fixed 版本组、release 归属） | 复核报告 + 验证脚本草案 |
| R1 | b1-r1-be | 复核 P0-5 / P1-1..P1-3 与 D2 段①：把 6 种列类型 × 5 种入参形态做成矩阵，**跑出当前实际 SQL 或错误**；确认打开 ValidateNested 的副作用（会不会把存量合法请求变 400）；确认 clamp 取值 | 复核报告 + 矩阵表 |
| R2 | b1-r2-fe | ① 先建 admin 最小 vitest runner（验证手段）；② 3 个组件回 admin；③ componentMap 换显式注册表；④ 删包与相关引用 | 代码 + 测试 |
| R2 | b1-r2-be | ① 算子按列类型选；② 值不可解释→400；③ 打开三槽位校验；④ pageSize clamp（DTO + builder 双保险） | 代码 + 单测矩阵 |
| R3 | b1-r3-fe | 复查：注册表全覆盖断言、73 处使用点回归、build:admin 与 types:check；**联动**：其它按目录名动态 import 的地方、unplugin-vue-components resolver 是否还指 @walnut/ui、docs 里引用该包的地方 | 复查报告 + 补充测试 |
| R3 | b1-r3-be | 复查：矩阵回归、存量 api-spec 是否变红、openapi diff 是否只含预期变化；**联动**：data-scope 手写 SQL 是否共用同一套算子推断 | 复查报告 + 补充测试 |

**写入面**：apps/admin/**、packages/platform-web/ui/**、apps/server/libs/{repository,decorators,list}/**
**门禁**：admin test、server test、types:check、lint、boundaries

---

### 批次 2 · P1 门禁可信化（**后续所有批次的保险**）

**目标**：让「机制存在但没人检查它是否生效」这类失败在 CI 里就红。不做这批，后面每批都可能在无门禁状态下改。

| 轮 | Agent | 任务 |
|----|-------|------|
| R1 | b2-r1 | 逐条复核 D18①② + D19 + D14，**实测「现在漏检什么」**：造 3 个负对照（admin 偷 import @walnut/node-*、barrel 里加一个 0 引用导出、lib 里加一个向上层 import），确认今天**全部不报错** |
| R2 | b2-r2 | ① 补 frontend tag 规则；② barrel 从 knip entry 摘出 → 专用「0 引用」脚本（报告模式 + 白名单）；③ madge 0 环进 prepush；④ D14 注册面生成化（lib 清单单一真源 → 生成 paths/nest/swcrc/include/ESLint files） |
| R3 | b2-r3 | 把 R1 的 3 个负对照**重跑**，必须全部变红；补 2 个正对照（合法 import 不误报）；核对 prepush 耗时增量；核对 drift spec 降级后仍能拦手工漏改 |

**写入面**：turbo.json、knip.config.ts、apps/server/eslint.config.ts、apps/server/infra/nest/*、apps/server/tsconfig*、apps/server/.swcrc*、packages/tooling/scripts/src/ci/**

---

### 批次 3 · P1 结构与部署面

**目标**：platform-node（D4）+ worker 生产面（D3）。两者互补 —— worker 是 platform-node 的第二消费方。

| 轮 | Agent | 任务 |
|----|-------|------|
| R1 | b3-r1-poc | 只做一件事：const 单库搬迁 POC 的可行性复核。实测当前 server build 的 dist 布局、tsconfig.app include/rootDir、nest-cli projects、SWC 配置；预测搬到 apps/server 之外后 dist 路径是否变；给出 POC 的 4 条验收命令 |
| R1 | b3-r1-worker | 复核 worker 生产面缺口：镜像入口、compose service、CI 冒烟点、WORKER_STANDALONE 语义、cron 单实例约束（ADR 0025）；确认「同镜像不同 CMD」是否可行 |
| R2 | b3-r2-poc | 执行 POC（const → packages/platform-node/base），跑 4 条验收。**POC 未通过则停，回报 Lead**，不进入批量 |
| R2 | b3-r2-worker | 补镜像第二入口 / compose service / CI 冒烟（断言 cron jobs > 0） |
| R3 | b3-r3 | 复查 POC 后的 dist 与 start:prod、openapi 无 diff；复查 worker 冒烟在 CI 真跑；**联动**：turbo 缓存边界（新包是否进 globalDependencies）、platform-node tag 规则是否开始真正生效 |

---

### 批次 4 · P1 契约与资产

**目标**：list wire 换契约（D2 段② + D15）+ packages 收拾（D6–D9、D20）。

| 轮 | Agent | 任务 |
|----|-------|------|
| R1 | b4-r1-wire | 复核 21 个 controller + useTableAPIListParams.ts + 16 个 .vue 的真实入参形态，产出「旧 wire → 新 wire」映射表；确认没有绕过 hook 的直连调用 |
| R1 | b4-r1-pkg | 复核三桶 75 导出的 0 消费、types 标签、utils 16 个浏览器值、api-types 归位与 openapi:check 两段拆分、TinyMCE 出镜像的连锁面 |
| R2 | b4-r2-wire | 换 filters wire + 默认排序 id 兜底 + openapi/schema 重生成 |
| R2 | b4-r2-pkg | 删桶 / 改标签 / utils 收缩 / api-types 归位 / TinyMCE 移出 |
| R3 | b4-r3 | 复查：前端 3 个代表性表格页、每个端点一条 api-spec、openapi:check 两段在无 secret 下也生效；**联动**：contract 快照测试、api-types 的 78 个消费点、turbo 缓存边界、docs 里对 ui/utils 的描述 |

---

### 批次 5 · P2 结构债与数据

**目标**：libs 结构债（D10–D13）+ seed 重建（D5）+ 命名（D16）。

| 轮 | Agent | 任务 |
|----|-------|------|
| R1 | b5-r1-libs | 复核锁两套（10 处直连 murlock）、cache 8 个域缓存、三模式→两模式的迁移面、8 个小库合并可行度；产出逐项迁移清单 |
| R1 | b5-r1-seed | 复核 db:export:pg 输出形态、seed-map.ts 938 行映射面、ejson.ts 消费点；设计「新旧双跑 diff 全等」的验收脚本 |
| R2 | b5-r2-libs | 锁端口化 → cache 域缓存显式化 → Repository 两模式 → 小库合并（删 delay、context 并入 als） |
| R2 | b5-r2-seed | seed 重建（机械再生成）+ locale groupKey + roles_* 冻结登记 |
| R3 | b5-r3 | 复查：全量 test / build / start:prod；**联动**：data-scope、守卫链（4 个 guard 用 murlock）、recoverable.registry、check-seed 门禁、seed 双跑 diff |

---

## 四、跨批次纪律

1. **一批一提交**（或按子任务 A/B 各一提交），scope 用受支持的值；不用 git add -A。
2. **R2 之前必须先有 R1 的「验证手段」** —— 否则 R3 无从判断是否修对（本仓已吃过三次「机制在、没人验」的亏）。
3. **R3 必须复查联动**，且要回答一句：「这次改造有没有让别的门禁/约定失效？」
4. 每批结束更新本文件的状态列，并在 [07](./07-decisions.md) 记录偏差。
5. 任何一批的 R1 若判定「问题不存在或已自愈」，**该批直接取消**，不硬做。

---

## 五、状态追踪

| 批次 | R1 | R2 | R3 | 备注 |
|------|----|----|----|------|
| 1 · P0 止血 | ✅ | ✅ | ✅ | 已提交 `ff5ffdfe` + `23106e1c`；见 §七 |
| 2 · 门禁可信化 | | | | 依赖批 1 的 admin runner |
| 3 · platform-node + worker | | | | POC 不通过则中止 |
| 4 · 契约与资产 | | | | 依赖批 2 的门禁 |
| 5 · 结构债与数据 | | | | |
---

## 六、批次 1 · R1 复核结论与裁决（2026-11-02）

两份 R1 报告：`reports/batch-1/r1-fe-verification.md` ·
`reports/batch-1/r1-be-verification.md`（均为 550 行左右，全部结论带实测输出）

### 6.1 前端：确认成立，但两处口径要改

| 项 | R1 结论 |
|----|---------|
| 断键穷举 | **3 个**（DynamicTags / Switch / TimePicker），27 通 3 断；"没有第四处"是**结构性**的 —— 全 app 52 处 import() 只有 4 处是插值，其余 48 处静态字面量，缺文件构建期就红 |
| 数字口径 | `Base:Switch` 正确数是 **63 处 / 18 文件**（此前 73 是把裸字符串与文档引用一起数了）；用户可见面 = DevSettings 8 + 我的-偏好 3 |
| 为什么没被发现 | 两条通路独立：模板 `<WXxx>` 走 unplugin resolver（`plugin/component.ts:13` 用 ui 包 glob **覆盖** admin 同名项 ⇒ 构建绿）；表单 `Base:Xxx` 走 componentMap 相对路径 ⇒ 悬空。`components.d.ts` 有 `WDynamicTags` 却**没有 WSwitch**，正是"模板从未用过"的铁证 |
| 第二类更隐蔽的断 | `getTargetComponent` 查不到 key 时**静默不渲染**（不报错不占位）。对账后：实际使用但缺 key = **0**；反向冗余 15 个 key |
| 断言方案 | 实测三档：静态路径校验 19ms/30 key/零 mock/恰好 3 断；运行时 loader 方案 16 个 broken 里 13 个是环境缺失（localStorage/JSX/虚拟模块/pinia）⇒ **噪声当信号**，不做门禁 |

**裁决**
- **Q-A → 走"消灭"路线**：4 处插值全换显式静态 import（缺文件 = 编译期红），**不给 admin 引 vitest**；
  另在 `@walnut/scripts` 加 `check-dynamic-imports` 门禁禁新增插值 import（与 lint:docs-refs 同范式）。
  → 这使原计划的「D18③ admin 最小 runner」**改为门禁脚本**，偏差已记录到 [07](./07-decisions.md)。
- **Q-B → 现状类改写 + 历史类豁免**（10 改 / 4 豁免，照 `@walnut/ai` 先例）。
- 删包有 **6 条硬红**（admin/package.json、冻结 lockfile+CI、Form/types.ts+vue-tsc、
  versioning 测试、attribution 测试、docs-refs）与 **7 处不会红**（root turbo boundaries、knip、
  nest.ts eslint 禁令等）——施工时不要在上面白费功夫。

### 6.2 后端：P0 比原报告**更宽**，且推翻了本目录的一条旧结论

| 项 | R1 结论（连真 PG 实测） |
|----|---------|
| 问题宽度 | 不是"字符串→ILIKE"一条路，而是**值的 JS 类型与列类型不匹配的全谱**：30 格里 **22 格**炸，四种 PG 码 42883 / 22P02 / 22007 / 22008。只有 text+varchar 列全形态安全 —— 这就是"平时没发现"的原因 |
| 直觉修法是错的 | "非字符串改成 eq"：那 18 格 eq 里仍有 **9 格** 500（uuid 收 "123" → 22P02、timestamptz 收 true → 22007）。必须**按列类型决定算子且校验值** |
| 观测口径（重要） | 全局过滤器永远回 **HTTP 200**（`exception.filter.ts:93`）：崩溃 = `200 + code 50000`，校验拒绝 = `200 + code 40099`。**验收断 HTTP status 会永远假绿** |
| 推翻旧结论 | 「page 半传 ⇒ OFFSET NaN」**不成立**（嵌套 transform 逐字段补默认，实测 `skip=0 limit=20`）。真正 NaN 入口只有 `page.page` 非数字。修 page **不要动** `@Type`/`default` |
| page 其余实测 | `pageSize=1e9` → `LIMIT 1000000000` 成功发出；`page=-1` → 2201X；`pageSize=-5` → 2201W；`pageSize=0` → `LIMIT 0` **静默空页** |
| clamp 双落点 | `pageSize` 有 3 条消费链，只有 1 条经 builder；`logger.service.ts:53,97-100` 与 `cache.service.ts:30-32,549` 在内存 slice。上限保 9999（全仓实际最大 100，零回归） |
| 校验回归面 | 20 处 api-spec 请求体全合法；两个雷：`sort[].order: false`（contract 允许但 IsEnum 拒）、`AppLoggerDTOListRequest` 缺 `sortOnlyIn`。反向陷阱：**别加 IsNotEmptyObject**（`query:{}`/`sort:[]` 合法） |
| 同源缺陷（新增） | ① `sort` 未知 field ⇒ 默认排序被**整体清空** ⇒ 无 ORDER BY ⇒ 翻页重复/丢行；② `order:"ASC"` 大写被静默当 DESC；③ `locale.repo.service.ts:79,94-117` 与 `deleted.basic.repository.ts:63-75` **各自复制了一套分派**，只改 builder 会分叉 |

**裁决**
- **Q1 → 丢弃条件 + warn**（不做 400）：P0 的唯一目标是把 500 变不见；严格 400 留给批次 4 的显式 filters 契约。
- **Q2 → `IsIn(['ascend','descend',false])`**（保留 false，不动 contract 快照）。
- **Q3 → JOIN 放大导致 total 不准记 P2**，本轮不做。
---

## 七、批次 1 结果（2026-11-02 收口）

**状态**：R1 ✅ → R2 ✅ → R3 ✅ → 收尾 ✅ → **已提交**

| 提交 | 内容 |
|------|------|
| `ff5ffdfe` `fix(admin)` | 表单注册表改静态映射 + 删除 `@walnut/ui`（包数 16→15）+ 新增 `lint:dynamic-imports` 门禁 + 12 篇文档改写 |
| `23106e1c` `fix(server)` | list 入参按列类型分派算子（单一真源 `pg-column-op.ts`）+ 分页下沉 `libs/utils/src/list-page.ts` + 打开 sort/page 校验 |

### 7.1 三个 P0 的最终状态

| P0 | 结果 |
|----|------|
| 表单 3 个 `Base:` 类型运行时断裂 | **已修**。componentMap 30 条全部为字面量 import，30/30 说明符落地；R3 负对照证明改名后 `types:check` 与 `build` **双红**；产物里三个组件各自成 chunk 且含真实代码 |
| list 3 类必现 500 | **已修**。R3 用「真 TypeORM qb → `getQueryAndParameters()` → 真 PG 执行」跑 36 格 × 2 路径，`LEAKED_TO_PG = 0` |
| 三槽位校验从未生效 | **部分修复**：sort/page 已开且存量调用全绿；**query 槽位暂不开**（R3 独立复现：开了会让 9 条现存请求体 / 7 个端点变 400，根因是 query 基座为实体 DTO 的 partial 派生）→ 随批次 4 的显式 filters 契约收口 |

### 7.2 一条需要记住的观测口径（本批最大意外）

**全局异常过滤器永远回 HTTP 200**（`exception.filter.ts:93`）：崩溃 = `200 + body.code 50000`，
校验拒绝 = `200 + code 40099`。**任何"断言 HTTP 状态码"的验收用例都会永久假绿。**
本批所有验收因此改为断言 `body.code` 与"是否真的到达 PG"。

### 7.3 收尾轮修掉的、R2 没报的问题

| 来源 | 问题 |
|------|------|
| Lead 跑门禁 | `check-dynamic-imports` 有 **tsc 与 eslint 互斥**的类型错误（`Array.from({length}).fill(false)` 是 `unknown[]`，但 `e18e/prefer-array-fill` 又强制它）→ 已修；**R3 声称"types:check 绿"实际只跑了 admin 的** |
| R3-FE | `^reports/` 被放进 `FROZEN`（全免）比仓里先例更宽 → 收窄为 `PATH_CHECK_EXCLUDED`（只免路径、包名仍受检），三连实验复验 |
| R3-FE | 新门禁 3 个洞：`obj.import(x)` 误报、`import('a'+b)` 漏报、不扫未跟踪文件 → 全修 |
| R3-BE | R2 漏报第二处默认排序变化（`monitor/user → id DESC`）；`sort[].priority` 由"被忽略"变"必填"属未登记收紧 → 已放宽并登记 |
| R3-BE | 丢弃条件时 warn 带原值可能刷日志 → 改 debug 取样 + warn 汇总，且**不回显原值** |

### 7.4 本批新增/变更的门禁

- 新增 `lint:dynamic-imports`（1627 文件、0 豁免、14 条自测，已进 prepush 与 CI）
- `check-doc-refs`：`liveDocs()` 增加 `existsSync`（修它自己会崩的 bug）；`reports/` 路径引用进排除表
- 包数 16→15 的连锁：fixed 版本组、attribution、commitlint scope、turbo tags、ADR 0012/0014 全部同步

### 7.5 遗留（不阻塞，进批次 4）

- `sort[].priority` 在 OpenAPI 里仍标 required（要动 `packages` 的生成物，留批次 4）
- `query` 槽位的字段级校验
- 丢弃条件导致"静默过度返回"（uuid 列收不可解释值 → 返回全量）；**不跨权限边界**（数据权限不经 query）
---

## 八、P2 / P3 / P4 台账（2026-11-02 盘点）

### 8.1 口径

- **P2 已关闭**：批次 1 收尾轮修掉 **9 项**（前端 4 项 P2-a..d + 后端 5 项 P2-①..⑤），逐条见 `reports/batch-1/r3fe-fixup.md` 与 `reports/batch-1/r3be-fixup.md`。
- **P2 未关闭**：**3 项**，全部**有意推迟**到批次 4（都要动 `packages` 的生成物或契约），不阻塞其他批次。
- **P3 未关闭**：**9 项**（前端 3 + 后端 6），都是"同源风险的第二现场"，按批次 2/5 分摊。
- **P4**：目前 **0 项**（本轮调研未产生 P4 级结论）。

### 8.2 P2 未关闭（3 项 → 批次 4）

| # | 项 | 为什么推迟 | 判据 |
|---|----|-----------|------|
| P2-A | `query` 槽位的字段级校验 | 开了会让 9 条现存请求体 / 7 个端点变 400，根因是 query 基座为实体 DTO 的 partial 派生（背着必填与创建语义约束）。要开得先重写约 8 个基座 DTO | 批次 4 的显式 `filters` 契约落地后，query 基座整体退役 |
| P2-B | `sort[].priority` 在 OpenAPI 里仍标 required | 改 swagger 要重导 `packages/platform-web/api-types/src/schema.d.ts`，本轮禁止动 `packages` 生成物 | 值域已放宽（缺省跳过、显式 0 合法），只剩"schema 说 required"这一处不诚实 |
| P2-C | 丢弃条件导致"静默过度返回" | uuid/布尔列收到不可解释值时条件被丢弃 ⇒ 返回全量。**已确认不跨权限边界**（数据权限不经 query），且当前无客户端这样传 | 批次 4 契约用显式 op + 400 拒绝替代"丢弃" |

### 8.3 P3 未关闭（9 项）

| # | 来源 | 项 | 归入 |
|---|------|----|------|
| P3-F1 | `reports/batch-1/r3-fe-review.md` | `check-dynamic-imports` 漏报 `import('a' + b)`（现有立场"宁可漏报"） | 批次 2 |
| P3-F2 | 同上 | `router/utils/route.ts` 的 `views/**` glob 缺"路由 view 必须命中"断言（同类静默故障的最后一处） | 批次 2 |
| P3-F3 | 同上 | 根 `AGENTS.md` 字数预算已用 94%（余量约 497 字符） | 批次 2（只许等长替换） |
| P3-B1 | `reports/batch-1/r3-be-review.md` | `ILIKE_ESCAPE_REGEX` 成死 API（仅 re-export，0 消费者） | 批次 5 |
| P3-B2 | 同上 | 无 `raw` 的手写 `match` 通道仍在（当前零生产调用点，但会绕过本轮兜底） | 批次 5 |
| P3-B3 | 同上 | 布尔列收到 `1`/`0` 由"能过滤"退化为"静默丢弃" | 批次 5 |
| P3-B4..B6 | 同上 §P3（另 3 条） | 见报告原文，均为 S 级 | 批次 5 |

### 8.4 批次 1 遗留（并入批次 4）

- 浏览器内**真实渲染**未验（DevSettings 需登录）：R3 只证明到"产物里 30/30 key 指向存在的独立 chunk 且含真组件代码"。
- `sort[].priority` 与 `query` 的 OpenAPI 口径（= P2-A / P2-B）。

### 8.5 后续批次（本文件 §三 的 2–5 批，不变）

批次 2 门禁可信化 → 批次 3 platform-node POC + worker 生产面 → 批次 4 契约与资产 → 批次 5 结构债与数据。
P3 台账已按批次分摊（见 8.3 最后一列），各批 R3 收尾时一并收掉。
---

## 九、夜间执行记录（2026-11-02 23:00 — 11-03 00:0x）

### 9.1 已完成并提交

| 批次/模块 | 提交 | 内容 |
|---|---|---|
| 批次 2 R2 | `c8d72591` | frontend 边界（platform-web deny platform-node）、knip 补 project+includeEntryExports（unused 50→139，把盲区变可见）、madge 进 prepush（25 段）、`walnut-scaffold-lib` 脚手架 |
| 密钥交换 P0 | `243847a1` + `c60545d1` | 补 `await`（40012 从死码变可达）+ 加密前判空 + 错误屏「重置本机密钥」 |
| 设备模块 P0 | `97012f3b` + `6dd7c784` | 指纹不再下发响应面 / cookie 滑动续期 / 封禁踢下线（撤 RT + 清会话 + 断 WS）/ cron 只标 stale / 前端 40605 自愈 |

### 9.2 运行期实测**发现并修复**的两个 P0（静态 review 抓不到）

1. **错误掩盖**（`6b45edc8`）：bootstrap 早于 naive-ui provider 挂载，`useAppMessage()` 返回 `{}`，
   `AppMsg` 调 `.create()` 抛 TypeError，**把真实失败原因整条盖住**。浏览器实拍错误屏显示的就是这条 TypeError。
   → 降级为 console.warn。
2. **公钥鸡生蛋死锁**（`ae0220b8`）：上一提交让 40012 变可达后，`/security/sign/initial` 仍走抛错版取值，
   于是「登记公钥要求先有公钥」——首次握手必 40012，api-spec 全线红、admin bootstrap 卡在 sign 步。
   → 新增 `findRsaPubKeyCache`（探测版，缺失返回 null），initial 改用它；需要「缺失即错误」的两处保持原样。
   补 2 条用例钉住分界。
3. 附带修复（`7c3570c6`）：`40608 Bot Detected` 不在前端 notAllowed 映射里 → 落到兜底分支；
   兜底 reject 从字面量「Missing Error Code」改成 `[code] msg`，任何未登记码都能定位。

### 9.3 端到端验证**通过**

修复后真浏览器（headed）打开 `https://localhost:3100`：**应用成功启动并停在登录页**，
CAP 人机验证（「诗人握持」挑战 + CaP 徽标）、账号/短信/邮箱三种登录、GitHub/Google/Gitee OAuth 全部渲染。
—— 这条链路同时覆盖了：设备 cookie 签发与校验、RSA/AES 握手、CAP 挑战、全局守卫链。

### 9.4 尚未完成（下一轮）

- 批次 2 的 **R3 复查轮**；批次 3 / 4 / 5 全部
- 设备 review 的 P1 三项：封禁改指纹绕过、心跳端点可污染他人监控行、lock 是否也踢下线（需决策）
- CAP review 的 P1 三项：`ttl` 三种单位（种子配置下 challenge 仅 3.6 秒）、cap.js token 硬编码 20 分钟、token 存单机文件
- 守卫 review：**顺序零门禁**（`getGlobalGuards` 0 命中）、Risk fail-open × CAP 放行、Lock `=== null` 永不命中
- skip 矩阵：`sign/initial` 与 `aes-key` 的 deviceId 来自未校验 Cookie（6/7 skip）、signout 缺 JwtFree、3 处多余 IpFree
---

## 十、批次 2 / 3 收口与 platform-node 的结论（2026-11-03）

### 10.1 批次 2（门禁可信化）—— 完成，R3 挡了一次提交

| 轮 | 结果 |
|---|---|
| R1 | 3 个负对照实测：frontend 缺口坐实（admin 可偷 import Node 包，boundaries 绿）；knip 对 barrel **部分**盲区（http 报得出、contract 报不出）；madge 10.3s |
| R2 | platform-web 加 `deny:[platform-node]`；knip 5 包补 `project` + `includeEntryExports`；madge 进 prepush（25 段）；`walnut-scaffold-lib` 脚手架（幂等，45 净行） |
| R3 | **挡提交**：`steps.ts` 加了 circular 行但 fixture 与 release.md 电池表没同步 ⇒ `@walnut/release` 2 个用例红。且 `prepush` 的 25 段里**没有 test 段**，所以这类失败推送拦不住。已修（`c4291678`） |

R3 同时给出 knip 的账：**+114 条里 87% 落在 3 个 barrel 上，而这 3 个包入口的全仓 import 语句数 = 0**；
99 个符号里 89 个是经深路径被真实消费的 —— 不是死代码，是「入口没人走」被拆成 99 行。真死只有 3 条。
最尖锐：报得出来的 3 个入口零消费，唯一有入口消费的 `contract` 恰好报不出来，两个集合无交集。
→ 结论：knip 现在是「更吵且吵错方向」，降噪的根因解**就是 D8（删三个桶）**，已在批次 4 一起做。

### 10.2 批次 3 —— worker 已真接线；**platform-node 的 POC 不通过**

**worker（D3=A）已完成**（`fdf7392f`）：compose 加 worker service（同镜像 + command 覆盖 +
`WORKER_STANDALONE=true` 写在容器 environment + depends_on healthy + 无 healthcheck + 日志分离）、
api 侧同步该变量（否则 cron 双跑）、CI 在已有 PG/Redis 的 openapi job 里加冒烟（轮询等待，
负对照 `cron jobs: 0` 会红）。实测冒烟 step 12s、build 后 `dist/apps/{api,worker}/src/main.js` 都在。

**platform-node：`const` 单库 POC 不通过**，三条失败面都不在构建期暴露：

1. `@swc/cli` 的 `getDest` 决定 dist 布局 = 源文件相对 cwd 的**逐字符镜像**。把 `filenames` 指向
   `../../packages/...` 后 **build 仍 exit 0、verify 绿**，但产物被写到 `<root>/apps/packages/...`（逃出 dist），
   `start:prod` MODULE_NOT_FOUND。
2. 唯一开关 `stripLeadingPaths` 是全局布尔：开了 dist/packages 对了，但 `dist/apps/api/src/main.js`
   塌成 `dist/api/src/main.js` —— Dockerfile CMD 与 start:prod 全废。
3. `include` 加跨包路径会让 assets strip root 上提到工作区根 ⇒ `verify-build-assets` 红；
   补 `rootDir` 能救绿但成为第 10 个注册面；且 `types:check` 跳出 `apps/server/node_modules` 解析链爆 12 条 TS2307。

**⇒ D4「零 import 改写、只改 5 面」的前提不成立。** 剩下两条路：

| 方案 | 内容 | 代价 |
|---|---|---|
| **P1** | platform-node 自建 CJS dist（照 `@walnut/contract` 样板），apps/server 消费 dist | 新构建流水线 + peerDeps(@nestjs/*) + 装饰器元数据验证 + 28 库搬迁；M→L |
| **P2** | 放弃搬迁，保留 `libs/` 现状 | 收益 = 边界清晰；今天这条收益由 ESLint 六层分层 + drift spec 已经提供 |

**当前状态：等用户拍板**（P1 还是 P2）。worker 已真接线，所以「第二个 Node 消费方」这个理由已经成立，
但它和 api 共享同一份构建产物 —— 这个事实**削弱**了「必须拆包」的必要性。

### 10.3 已修的 P1（来自模块 review）

| 模块 | 提交 | 内容 |
|---|---|---|
| CAP | `31bdb8bb` | ttl 三单位归一（种子 3600 下 challenge 从 3.6 秒修正为 60 分钟）、缓存窗口 = min(ttl,20min)、畸形 cookie 500→40116、40111 唤醒、Lock `=== null` → isNil |
| 前端 | `1a04803f` | 40117 单次重试，避免 refresh 失败无限重放 |

CAP 的一处**口径收窄**（已知并记录）：40111 只在「本地可证 cookie 不是 cap.js token 形态」时抛；
`success:false`（已消费/过期）仍走 40116/40117 自愈 —— 否则前端跳 not-allowed，等于每 20 分钟踢一次全部在线用户。

### 10.4 待你拍板（3 条）

1. **platform-node 走 P1 还是 P2**（见 10.2）——这条改变架构方向，我不替你定。
2. `deploy/post-verify.sh` 只查 3 个容器 ⇒ worker 崩溃循环时部署仍判绿，要不要一起修。
3. CAP × worker：worker 让进程数 1→2，而 CAP 自报「必须单实例」——要不要给 `.data` 挂共享卷，或让 worker 不实例化 CAP。
---

## 十一、批次 7–10 排期与 B5 的范围裁定（2026-11-03）

### 11.1 批次 7（并行三路 + 一路调研）

| 路 | 内容 | 性质 |
|---|---|---|
| 7-A | 集成套件 10 条红（40101 处理器前拒绝）是否本轮 guard/lock/refresh 改动的回归 | 只读 triage |
| 7-B | api 侧 SIGTERM 竞争：cap.js 构造期注册 `process.exit(0)`，早于 `enableShutdownHooks` | 实施 |
| 7-C | 四条 S 级：guard 顺序写进 AGENTS、`exports-glob-matches` 的 `*` 语义、prepush 加 `test` 段、signout 加 `JwtFree` | 实施 |
| 9-R1 | B5 服务端签发随机 deviceId 的迁移方案（只读） | 调研 |

### 11.2 B5 的范围裁定（Lead 决定，2026-11-03）

B5 调研中途给出三条实测/读码事实，改变了 B5 的定位：

**事实 1：B5 单独落地关不掉「封禁绕过」。** 现在的绕过是「改指纹一个字符」；改完后变成「清 cookie 直接
匿名 initial 铸新随机 id」，成本几乎相同。**B5 真正买到的是「不能指定自己拿到别人的身份」**
（定向冒充与 SSE 劫持链断掉），不是「不能重新造一个身份」。

→ **裁定：接受这个范围。** B5 定位为**身份完整性修复**，不是反封禁绕过。理由是「反绕过」永远有成本：
按 `fingerprint_hash` 关联执法会误伤 VPN / 无痕 / 换设备的正常用户，那是**产品口径**问题（要不要为
降噪牺牲可用性），不属于架构修复。**记为待产品决策**：要不要在 `initial` 时按 fp 命中已封禁行则加挑战。

**事实 2：有一个必修的连带改造。** `uq_device_name` 唯一 + 前端 `deviceName = ${detectDeviceType()}_${指纹前6位}`。
今天同指纹恒 upsert 同一行所以撞不到；改成随机 id 后，同一浏览器清 localStorage/cookie 再 initial
⇒ 同 deviceName 插第二行 ⇒ 23505 ⇒ 40000 ⇒ **该设备永远注册不上**。
→ **B5 必须先做**：deviceName 改服务端生成，或放开该唯一约束（二选一，实现前要定）。

**事实 3：最大技术风险在签名握手。** RSA 公钥缓存键是 `SECURITY:RSA:PUB_KEY:<deviceId>`，
`sign.guard` 拿不到就抛 40012；而前端 `setupSign` 只在「本地没有密钥对」时才重新握手。
→ deviceId 轮换若不同步搬运密钥，客户端会**永久 40012（刷新治不好）**。
轮换必须**原子搬运四个键族**：`SYSTEM:DEVICE` / `COOKIE_RENEW` / `RSA` / `AES`
（实测 Redis 里该族键已分别有 394 / 27 / 191 个）。

### 11.3 批次 8–10

- **8**：B2 风控 fail-open 分级（按端点敏感度，登录/注册/重置密码 fail-close）+ B3 撤 3 处多余 `IpFree` + B6 心跳行键
- **9**：B5 实施（按 11.2 的三条前提，分步发布）+ C3/C5/C6/C7/C8 批量小项
- **10**：D 组结构债（`SysLogAuthSharedModule` 的 @Global 违规、`SysUserOAuthSharedModule` 死模块，单开 3 轮制）+ E 组文档
### 11.4 B5 的 8 条拍板（Lead 裁定，2026-11-03）

B5 的 R1 报告（`reports/batch-9/r1-device-id.md`）给了完整方案与 8 条待决；裁定如下。

| # | 问题 | 裁定 | 理由 |
|---|---|---|---|
| 1 | B5 的目标是「不能指定别人的身份」还是「不能再生身份」 | **明写前者** | 后者做不到（清 cookie 即可）；按后者写会把「封禁仍是降噪」这件事藏起来，下一个人会以为封禁是安全控制 |
| 2 | `deviceName` 归谁 | **服务端生成**（设备类型 + 服务端随机后缀） | 现在是 `${detectDeviceType()}_${指纹前6位}`，随机 id 化后同 deviceName 第二次 initial 必 23505→40000，设备永久注册不上；服务端生成同时保住可读性 |
| 3 | 换发点 | **只在 R1 匿名 + R2 登录两处，不在 initial** | 在 initial 换发会在「已登录时被换发」= 踢人；initial 的正确语义是「同 cookie 同 id」 |
| 4 | 要不要 `legacy_device_id` 做无损回滚 | **要** | 迁移期唯一的回滚手段；M3 收口（CHECK 能 VALIDATE = legacy 清零）才允许删列 |
| 5 | 双读窗口 | **60 天** | 与设备 cookie 寿命（30 天）+ 一次续期周期对齐；短于 45 天必有用户被强制重握手 |
| 6 | L4（90 天留存清理）是否同批 | **同批**，排在 L3 灰度之前 | 随机 id 化会让「清 cookie 重开」产生新行，设备行会膨胀；不先有留存策略，灰度等于放大脏数据 |
| 7 | 设备行膨胀 | **靠 `stale` + 90 天留存删除** | 与「cron 只标 stale」配套：标 stale 管「不复活封禁」，留存删除管「不无限膨胀」，两者不能互相替代 |
| 8 | `DEVICE_ID_ENCRYPTION_KEY` 怎么处置 | **保留，且继续列入「部署后不许改的 5 个」** | B5 之后它不再是**身份**的根（不再 HMAC 指纹），但仍是**历史数据**的解密根；轮换一次，旧的 deviceId / 指纹映射就再也解不开 |

**R1 另外三条实测，实施时必须照做**：
1. 改键前**先加 `ON UPDATE CASCADE`**：两处 FK 的 `confupdtype='a'`（NO ACTION），原地改键会 23503。
2. 换发事务内**必须 RENAME** `RSA:PUB_KEY:<id>` 与 `AES` 键族 —— 漏搬 = 客户端永久 40012（刷新治不好）。
3. 双读判别只能靠 **`d1_` 前缀**：legacy 是 64-hex，长度与字符集判别必然混淆。

**对批次 1–6 的连带要求**：
- 滑动续期与封禁踢下线：**保留且地位升级**（它们是换发后仍能工作的前提）
- cron 只标 stale：**保留机制，但理由变了**，并补 90 天留存清理
- `visitorId` 从响应面移除：保留，**并把请求面也摘**（心跳行键改 cookie deviceId，`app_monitor_user.visitor_id` 可退役）—— 这条与批次 8 的 B6 是同一件事
- `initial` 幂等：**反转成「同 cookie 同 id」**，直接改 `device.api-spec.ts` 的现有断言
