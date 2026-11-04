# packages / server 架构调研汇总（决策已定版）

> 更新：**2026-11-02** 初版 ｜ 基线 commit `3aa32f1f`，工作区有并行线在改（见 §六）
> **2026-11-03 修订：D4（建 `packages/platform-node`）的「直接搬迁」分支被实测否决** ——
> `const` 单库 POC 不通过，现状 = 不搬（P2）。详见 [10](./10-implementation-plan.md) §10.2 与
> [07](./07-decisions.md) 的 D4 修订记。**本页与 06/07/08/09 里凡写「建 platform-node」的地方都按这条读。**
> ⚠️ **原始 6 份调研报告（01/02/03/03b/04/05）已删除**（未跟踪文件，git 无法恢复）。本文件 +
> 06/07/08/09/10 为重建。**六份过程稿不再重出**：结论以本页 §一 + [06](./06-cross-check.md) /
> [07](./07-decisions.md) / [08](./08-recommended-plan.md) / [09](./09-research-summaries.md) /
> [10](./10-implementation-plan.md) 为准。理由是**同一结论留两处必然漂移**：过程稿冻结在 2026-11-02 的树，
> 而决策在 2026-11-03 已经改过一次（D4 的「直接搬迁」被实测否决，见 §二）；再造一份「按最终树重出」的长文，
> 等于明天多出一份要同步的旧账 —— 查「当时怎么得出这个结论」看 06 的复核记录与 09 的浓缩重建就够了。

---

## 一、四个问题的答案

| # | 你的问题 | 答案 |
|---|---------|------|
| 1 | platform-any 的导出是不是都被消费了 | **三包命运不同**：`@walnut/contract` 站得住（运行时值双端率 **78.1%**）；`@walnut/utils` **负资产**（13.6%，实质是浏览器密码学包）；`@walnut/types` **负资产**（后端 **0** 文件消费，却自称双端） |
| 2 | 还有没有 mongo/mongoose 遗留 | Mongoose **可执行代码已清零**；但 **list 入参仍是 Mongo find(filter) 的直系后代** —— 算子由「值的 JS 类型」隐式决定 ⇒ **3 类必现 500**，三槽位校验**从未生效**，seed 真源仍是 Mongo EJSON |
| 3 | 只抽 platform-any/web 有必要吗？后端基建能不能下沉 | 有必要，但 4 个 web 包差一个量级（client 84 / http 10 / api-types 79 / **ui 2–3**）。**后端基建当时定为下沉、建 `packages/platform-node`（D4，2026-11-02）；2026-11-03 的 `const` 单库 POC 实测不通过，直接搬迁被否决 —— 现状 = 不搬（P2）；要恢复包边界只能走 P1（两个包自建 CJS dist，待拍板）** |
| 4 | server libs 与 apps 三包架构还有优化空间吗 | **分层是真的**（34 库、1481 条 import、**0 条向上层边**、madge **0 环**）；空间不在分层，在 **4 个结构债**：注册面成本、cache 住域缓存、锁两套、worker 无生产面 |

---

## 二、已定决策（6 条，详见 [07](./07-decisions.md)）

| # | 结论 |
|---|------|
| D0 | **a：单体内后台** —— 抽包正当性 = 本仓自己的复用 |
| D1 | **删除 `@walnut/ui`** + 把 `componentMap` 的目录名动态 import 换成显式注册表 |
| D2 | **两段走**：先止血（按列类型选算子 + 打开校验 + clamp），再一次性换显式 `filters` wire |
| D3 | **worker 真接线** —— 补齐生产编排与 CI 冒烟（本地本来就能跑，是我上轮表述不准） |
| D4 | ~~建 `packages/platform-node`~~ → **2026-11-03 实测否决「直接搬迁」**（POC 不通过）：现状 **P2 = 不搬**；P1 = 两个包自建 CJS dist（待拍板） |
| D5 | **seed 一次性重建**为 PG 行形态，机械再生成 + 双跑 diff 验收 |

---

## 三、必须先看的 5 条硬事实

1. **有一个活的 P0，是「抽离到 package」直接造成的**
   `packages/platform-web/ui` 把 Switch/DynamicTags/TimePicker 移出 admin 后，
   `componentMap.ts:56` 仍按 admin 目录名动态 import ⇒ 3 个 `Base:` 表单类型运行时 Unknown variable dynamic import。
   `Base:Switch` 全仓 **73 处**（DevSettings 8 文件、/me 偏好 3 文件、菜单表单 8 处）——**不是 demo**。
   tsc 与 vite build 都看不见。三路调研独立命中，Lead 已复现。

2. **list 接口三个必现 500**（Lead 亲跑 vitest 实测）
   - `{"query":{"id":"abc"}}` → `id ILIKE '%abc%'` ⇒ uuid 无 ILIKE 算子 ⇒ 42883
   - `{"query":{"order":[1,2]}}` → 被判成日期区间 ⇒ uuid 比大小 ⇒ 500
   - `{"page":{"pageSize":999999}}` → `LIMIT 999999`（校验从未生效）

3. **三槽位校验从未生效**：`required: false` ⇒ 验证器只 push `Allow()`，不下钻。
   `sortOnlyIn` 白名单、`pageSize max:9999`、字段级 uuid/number 校验**全部只存在于 swagger**。

4. **`pnpm boundaries` 大半空转**：4 条 tag 规则 2 条不可能触发；`platform-node` 规则的唯一 subject 是
   `apps/server`（与 `backend` 等价）；**`frontend` 一条规则都没有**。修复约 3 行。

5. **库数是 34，不是 35**；`_id` 的「440 处命中」是宽匹配假阳性（`user_id` 这类**正确**的外键），
   按 token 边界精确统计后源码里**全是注释**。

---

## 四、目标态（2026-11-03 修订：platform-node 未建）

    packages/
      platform-any/     contract · types · utils        ← 跨端（零/低运行时依赖）
      platform-node/    base · tech                     ← 后端基建（28 库）**未建**：D4 的直接搬迁已于 2026-11-03 实测否决
      platform-web/     client · http                   ← 浏览器/Vue（删桶、删 ui）
      generated/        api-types                       ← codegen 产物（从 platform-web 挪出）
      tooling/          6 包（不动）

    apps/server/libs/   identity system auth security guards app-domain   ← 只剩 6 个业务域库
    apps/server/apps/   api（唯一 HTTP 单元）· cli（CI 真用）· worker（真接线，D3）

**依赖方向**：`apps/* → platform-web → platform-any`；`apps/server/libs/* →（tsconfig paths `@walnut-server/*`）→ platform-any`（**platform-node 未建**；若走 P1，则改回 `apps/server → platform-node(dist) → platform-any`）；
**永不允许** `apps/server → platform-web`。

---

## 五、文件清单

| 文件 | 内容 | 状态 |
|------|------|------|
| **00-INDEX.md** | 本文件 | 重建 |
| [06-CROSS-CHECK.md](./06-cross-check.md) | 复核记录：**我推翻的 1 条**、**被用户纠正的 1 条**、「搬完再补门禁」的排序裁决 | 重建 |
| [07-DECISIONS.md](./07-decisions.md) | **6 条已定决策 + 14 条 B 档**；D4 的 platform-node 设计与 4 个顾虑**保留为当时依据**，其中「dist 布局不变」这条已被 2026-11-03 实测证伪 | 重建 |
| [08-RECOMMENDED-PLAN.md](./08-recommended-plan.md) | 实施排期 P0–P7，每阶段验收与回滚 | 重建 |
| [09-RESEARCH-SUMMARIES.md](./09-research-summaries.md) | 六份报告的**浓缩重建**（原始全文已丢失） | 重建 |
| `01/02/03/03b/04/05` | 六份深度报告（每份 600–816 行、带 `path:line` 证据） | **丢失，不再重出**（页首说明了理由；结论以本页与 06–10 为准） |

---

## 六、工作区现状提醒

- 调研期间（14:33 起）工作区被**另一条并行线**持续修改，目前 **218 个文件**处于已修改状态，
  集中在 swagger / socket / health / guard / docs（连 `adr/0022` 与 `backend/architecture.md` 都被改了）。
- 所以本文档里所有计数都是**采集时点快照**（2026-11-02）；**2026-11-04 复核：工作树已 0 dirty**，
  上面的决策与实施计划都按这一状态收口 —— 剩下的事在
  [架构待办](/content/monorepo/architecture-todo)，不在这里重复。
- `reports/` 已被删除过一次。重建文件我已用 `git add` 纳入索引防止再次被 `git clean` 清掉；
  若你不想要它们进索引：`git reset reports` 即可。
