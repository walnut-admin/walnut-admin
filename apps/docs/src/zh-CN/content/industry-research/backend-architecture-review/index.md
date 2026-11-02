# packages / server 架构调研汇总（决策已定版）

> 更新�?*2026-11-02** �?基线 commit `3aa32f1f`，工作区有并行线在改（见 §六）
> ⚠️ **原始 6 份调研报告被删除**（未跟踪文件，git 无法恢复）。本文件 + 06/07/08/09 为重建；
> 六份全文（每�?600�?16 行）待并行线收工、工作树稳定后按最终树重出�?
---

## 一、四个问题的答案

| # | 你的问题 | 答案 |
|---|---------|------|
| 1 | platform-any 的导出是不是都被消费�?| **三包命运不同**：`@walnut/contract` 站得住（运行时值双端率 **78.1%**）；`@walnut/utils` **负资�?*�?3.6%，实质是浏览器密码学包）；`@walnut/types` **负资�?*（后�?**0** 文件消费，却自称双端�?|
| 2 | 还有没有 mongo/mongoose 遗留 | Mongoose **可执行代码已清零**；但 **list 入参仍是 Mongo find(filter) 的直系后�?* —�?算子由「值的 JS 类型」隐式决�?�?**3 类必�?500**，三槽位校验**从未生效**，seed 真源仍是 Mongo EJSON |
| 3 | 只抽 platform-any/web 有必要吗？后端基建能不能下沉 | 有必要，�?4 �?web 包差一个量级（client 84 / http 10 / api-types 79 / **ui 2�?**）�?*后端基建可以下沉 —�?已定为建 `packages/platform-node`**（D4�?|
| 4 | server libs �?apps 三包架构还有优化空间�?| **分层是真�?*�?4 库�?481 �?import�?*0 条向上层�?*、madge **0 �?*）；空间不在分层，在 **4 个结构�?*：注册面成本、cache 住域缓存、锁两套、worker 无生产面 |

---

## 二、已定决策（6 条，详见 [07](./07-decisions.md)�?
| # | 结论 |
|---|------|
| D0 | **a：单体内后台** —�?抽包正当�?= 本仓自己的复�?|
| D1 | **删除 `@walnut/ui`** + �?`componentMap` 的目录名动�?import 换成显式注册�?|
| D2 | **两段�?*：先止血（按列类型选算�?+ 打开校验 + clamp），再一次性换显式 `filters` wire |
| D3 | **worker 真接�?* —�?补齐生产编排�?CI 冒烟（本地本来就能跑，是我上轮表述不准） |
| D4 | **�?`packages/platform-node`**�? 个包�?8 个基建库下沉�?*�?import 改写**；前�?D14 + 1 �?POC |
| D5 | **seed 一次性重�?*�?PG 行形态，机械再生�?+ 双跑 diff 验收 |

---

## 三、必须先看的 5 条硬事实

1. **有一个活�?P0，是「抽离到 package」直接造成�?*
   `packages/platform-web/ui` �?Switch/DynamicTags/TimePicker 移出 admin 后，
   `componentMap.ts:56` 仍按 admin 目录名动�?import �?3 �?`Base:` 表单类型运行�?Unknown variable dynamic import�?   `Base:Switch` 全仓 **73 �?*（DevSettings 8 文件�?me 偏好 3 文件、菜单表�?8 处）—�?*不是 demo**�?   tsc �?vite build 都看不见。三路调研独立命中，Lead 已复现�?
2. **list 接口三个必现 500**（Lead 亲跑 vitest 实测�?   - `{"query":{"id":"abc"}}` �?`id ILIKE '%abc%'` �?uuid �?ILIKE 算子 �?42883
   - `{"query":{"order":[1,2]}}` �?被判成日期区�?�?uuid 比大�?�?500
   - `{"page":{"pageSize":999999}}` �?`LIMIT 999999`（校验从未生效）

3. **三槽位校验从未生�?*：`required: false` �?验证器只 push `Allow()`，不下钻�?   `sortOnlyIn` 白名单、`pageSize max:9999`、字段级 uuid/number 校验**全部只存在于 swagger**�?
4. **`pnpm boundaries` 大半空转**�? �?tag 规则 2 条不可能触发；`platform-node` 规则的唯一 subject �?   `apps/server`（与 `backend` 等价）；**`frontend` 一条规则都没有**。修复约 3 行�?
5. **库数�?34，不�?35**；`_id` 的�?40 处命中」是宽匹配假阳性（`user_id` 这类**正确**的外键）�?   �?token 边界精确统计后源码里**全是注释**�?
---

## 四、目标�?
    packages/
      platform-any/     contract · types · utils        �?跨端（零/低运行时依赖�?      platform-node/    base · tech                     �?后端基建�?8 库，**新建**�?      platform-web/     client · http                   �?浏览�?Vue（删桶、删 ui�?      generated/        api-types                       �?codegen 产物（从 platform-web 挪出�?      tooling/          6 包（不动�?
    apps/server/libs/   identity system auth security guards app-domain   �?只剩 6 个业务域�?    apps/server/apps/   api（唯一 HTTP 单元）�?cli（CI 真用）�?worker（真接线，D3�?
**依赖方向**：`apps/* �?platform-web �?platform-any`；`apps/server �?platform-node �?platform-any`�?**永不允许** `apps/server �?platform-web`�?
---

## 五、文件清�?
| 文件 | 内容 | 状�?|
|------|------|------|
| **00-INDEX.md** | 本文�?| 重建 |
| [06-CROSS-CHECK.md](./06-cross-check.md) | 复核记录�?*我推翻的 1 �?*�?*被用户纠正的 1 �?*、「搬完再补门禁」的排序裁决 | 重建 |
| [07-DECISIONS.md](./07-decisions.md) | **6 条已定决�?+ 14 �?B �?*，含 platform-node 设计�?4 个顾虑处�?| 重建 |
| [08-RECOMMENDED-PLAN.md](./08-recommended-plan.md) | 实施排期 P0–P7，每阶段验收与回�?| 重建 |
| [09-RESEARCH-SUMMARIES.md](./09-research-summaries.md) | 六份报告�?*浓缩重建**（原始全文已丢失�?| 重建 |
| `01/02/03/03b/04/05` | 六份深度报告（每�?600�?16 行、带 `path:line` 证据�?| **丢失，待重出** |

---

## 六、工作区现状提醒

- 调研期间�?4:33 起）工作区被**另一条并行线**持续修改，目�?**218 个文�?*处于已修改状态，
  集中�?swagger / socket / health / guard / docs（连 `adr/0022` �?`backend/architecture.md` 都被改了）�?- 所以本文档里所有计数都�?*采集时点快照**；实施前的第一步应该是**等并行线收工、重出六份报�?*�?- `reports/` 已被删除过一次。重建文件我已用 `git add` 纳入索引防止再次�?`git clean` 清掉�?  若你不想要它们进索引：`git reset reports` 即可�?