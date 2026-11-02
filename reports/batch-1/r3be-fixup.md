# R3 修正 · 批次 1 收尾（P2 五项 + 注释订正）

> 基线：HEAD `190a4c5d` + 两批在途改动。本轮**只动 `apps/server/` 与 R2 报告**，未触碰
> `apps/admin` / `apps/docs` / `packages/*`。**未 git commit**。
> 依据：`reports/batch-1/r3-be-review.md` 的 P2 清单。

---

## 0. 验收（五项门禁，全部亲手复跑）

| 门禁 | 命令 | 结果 |
|------|------|------|
| 单测 | `pnpm --filter @walnut/server test`（cwd 仓库根） | ✅ exit 0 — **79 files / 671 tests passed**（R2 是 665，本轮 +6：矩阵 3 条 + 校验 3 条） |
| 类型 | `pnpm types:check`（cwd `apps/server`） | ✅ exit 0（`tsc --noEmit --pretty` 无输出） |
| Lint | `pnpm lint`（cwd `apps/server`） | ✅ exit 0（0 error / 0 warning） |
| OpenAPI | `pnpm --filter @walnut/server openapi:export` → `git diff --stat -- apps/server/openapi.json packages/platform-web/api-types/src/schema.d.ts` | ✅ **零 diff**（220 schemas，`schema.d.ts` 同样零 diff） |
| 边界 | `pnpm boundaries` | ✅ `Checked 4645 files in 15 packages, no issues found` |

`openapi.json` 零 diff 这一点对 P2-③ / P2-④ **分别都成立**（分页常量改成 import 后值仍是 9999；
`priority` 用的是"不进 swagger 的 optional 选项"，见 §4）。

---

## 1. P2-① 登记 `/app/monitor/user/list` 的默认排序变化

**改法**：登记在**代码**里（比报告耐用）—— `libs/repository/src/pg-column-op.ts` 的
`defaultPgListSort` 文档注释新增一张对照表，逐条写明"旧 → 新"，并在 R2 报告 §1.4 同步补第二处。

**登记内容**（`pg-column-op.ts:190-205`）：

| 端点 | 实体 | 旧 | 新 |
|------|------|----|----|
| `POST /system/deleted/list` | `SysDeletedEntity`（无 createdAt） | 无 ORDER BY | `deleted_at DESC` |
| `POST /app/monitor/user/list` | `AppMonitorUserEntity`（无 createdAt，只有 firstVisitAt/lastActiveAt） | 无 ORDER BY | **`id DESC`**（uuid，稳定但业务无意义） |

其余 15 个 DB list 端点都有 `createdAt`，排序不变。注释里同时写明：若要"业务上有意义"的默认序
应显式给 `firstVisitAt DESC`（需产品确认，归批次 4）；以及 R3 P3 提到的
`sys_deleted.deleted_at` 可空 → `DESC` 默认 `NULLS FIRST` 的口径（本轮不改）。

---

## 2. P2-② 更正 R2 报告里过期的「9/20」口径

改 `reports/batch-1/r2-be-implementation.md` §3：

- 结论句改为 **「9 条请求体变 400，分布在 7 个端点上」**；
- 表头加 **「R3 更正（2026-11-02）」** 引用块，写明初版是 `default.ts` 修复**之前**的状态；
- 把 `POST /system/deleted/list`（原报 `deletedAt` range）与 `POST /system/dept/list`
  （原报 `unknownValue`）两行**划掉并标注"现在 PASS"**；
- 给 `/app/logger/list` 与 `/app/monitor/user/list` 标注**各 2 条**请求体（这就是 9 条 / 7 端点的由来）；
- §4「没做的与原因」里同一处数字一并改成「9 条请求体 / 7 个端点（R3 更正口径）」。

---

## 3. P2-③ 分页上限 `9999` 合成一处（真·单一真源）

**改法**：`libs/list/src/list.dto.ts` 改引 utils 常量 —— 方向合法（list 是 tech-assemble、utils 是 infra，向下）。

```text
libs/list/src/list.dto.ts:9   import { WALNUT_LIST_PAGE_SIZE_MAX } from '@walnut-server/utils/list-page'
libs/list/src/list.dto.ts:38  validateOptions: { int: true, min: 1, max: WALNUT_LIST_PAGE_SIZE_MAX, positive: true },
```

`libs/utils/src/list-page.ts` 那侧本来就是导出常量，现在**两侧共用一个字面量**，
R3 §5.3 说的"靠注释宣称同源"变成构造上的同源。openapi 零 diff（值仍是 9999）。

---

## 4. P2-④ `sort[].priority` 放宽成可选（默认 0）

**为什么选"放宽"而不是"认了"**：Lead 拍板零回归优先；且 builder 一直有 `priority ?? 0`
（`pg-list.builder.ts`），说明历史上就是允许缺省的 —— 是 R2 打开 `nestedWhenPresent` 后它
"从被忽略变成了真校验"，属未登记的收紧。

**实现（关键取舍：不进 swagger）**：给数字校验器加一个 `optional` 选项，而不是给字段加 `default: 0`。

| 方案 | 校验行为 | openapi |
|------|---------|---------|
| 字段加 `default: 0` + `defaultTransform` | 缺省 → 0 ✅ | **会变**（`priority` 加 `default`，且 `required` 可能缩水）→ 需重导 `api-types/schema.d.ts`（属 `packages` 范围，本轮禁止） |
| **校验器加 `optional`（采用）** | 缺省 → 跳过校验，builder 按 0 处理 ✅ | **零 diff** ✅ |

改动：
- `libs/types/.../decorators/number.d.ts`：`IWalnutAdminDecoratorValidatorNumberOptions` 新增 `optional?: boolean`；
- `libs/decorators/src/validator/base/number.validator.ts`：`optional === true` ⇒ 装饰器表退化成 `[IsOptional()]`（IsOptional 短路其余校验），其余分支不变；
- `libs/list/src/list.dto.ts`：`priority` 的 `positive: true` → `min: 0` + `optional: true`（显式给 0 也合法）。

**已知的 schema 与行为不一致（有意保留，已在代码注释登记）**：openapi 的
`SortDTO.required` 仍是 `["field","order","priority"]`，而校验已接受缺省。
把它改 honest 要重导 `packages/platform-web/api-types/src/schema.d.ts` —— 那是 `packages` 范围，
本轮明令不动；**建议批次 4 与 query 的 filters 契约一并收口**。

新增 3 条用例（`apps/api/src/common/list-request-validation.spec.ts`）：
缺 `priority` 通过 / `priority: 0` 通过 / `priority: -1` 仍被 `min` 拒。

---

## 5. P2-⑤ 丢弃条件的日志降噪 + 去原值

**R3 的两条问题**：① 每条 `warn` ⇒ 一个请求带 N 个非法过滤值就是 N 条，`logs/` 可被刷；
② 把 `raw` 截 120 字符写进日志 —— 过滤值可能是手机号/邮箱，与本仓「日志脱敏」口径不一致。

**改法**（`libs/repository/src/pg-column-op.ts`）：

```text
逐条        logger.debug   —— 含 property / kind / shape / reason / count，**不含原值**
汇总        logger.warn    —— 同一 (property|kind|reason) 每累计 100 次落 1 条
原值处理    describePgRawShape(raw)  →  'string(length=11)' / 'array(length=3)' / 'object' / 'number' …
```

- 可观测性**保留**：每条丢弃仍有 debug 明细可查；被削掉的是"每条都 warn + 带原值"。
- 计数器按 `(property, kind, reason)` 分组，避免不同端点互相把汇总顶掉。
- 导出 `DROP_SUMMARY_INTERVAL` / `resetDroppedPgListConditionCounters()` 供测试；
  同时删掉了不再使用的 `safeStringify`。

**顺带修掉 R3 P3-11 的"零信息量用例"**：原来那条
`expect(() => warnDroppedPgListCondition(...)).not.toThrow()` 恒真、且 spy 打在 `process.stderr.write`
（Nest Logger 不走那里）。换成 4 条真断言：

```text
✓ 逐条落 debug，且不打印原值（断言 message 不含 '13800138000'，含 'shape=string(length=11)'）
✓ warn 只在第 100 次落 1 条汇总（前 99 次 not.toHaveBeenCalled）+ debug 仍 100 次（可观测性保留）
✓ 不同 property/kind/reason 各自计数
✓ describePgRawShape 只描述形状（7 种输入）
```

---

## 6. 顺带：订正两处「注释与实现相反」

R3 §10 只点了 `logger.dto.ts`，我在同一文件里又发现一处同类（R2 遗留），一并改掉。

| 位置 | 原文（错） | 改成 |
|------|-----------|------|
| `libs/app-domain/src/logger/dto/logger.dto.ts:21-24` | 「list 的 query 槽位**已开** `nestedWhenPresent`…靠 `RealPartialType` 的 partial 语义放行」 | 只有 `sort`/`page` 开了、`query` 刻意没开；基座是 `RealPickType` 不是 `RealPartialType`；真正生效的是 sort 的 `onlyIn` 白名单（这也是本 DTO 要给 `sortOnlyIn` 的原因） |
| `libs/list/src/list.dto.ts:51-55`（`IWalnutAdminRequestListDTOOptions` 文档） | 「全局 ValidationPipe 对 list DTO 的 `sort` 数组**不做嵌套校验**」 | sort 槽位**已挂** `nestedWhenPresent`，`onlyIn` 是真校验（传白名单外会 400）；查询层还有第二道实体列收敛；query 仍未开 |

---

## 7. 没做的（明确出界）

| 项 | 原因 |
|----|------|
| 把 `priority` 的 swagger 也改 honest（`required: false` + `default: 0`） | 会改 `openapi.json` ⇒ 必须重导 `packages/platform-web/api-types/src/schema.d.ts` ⇒ 越界（本轮禁止动 packages）。已在代码注释登记，建议批次 4 与 query filters 契约一起收 |
| R3 的 6 条 P3（死 API `ILIKE_ESCAPE_REGEX`、无 raw 的 match 通道、boolean 收 1/0、page 上界、符号双入口、真 QB 渲染用例、`default.ts` 直接单测） | R3 判定不阻塞提交，Lead 本轮只点了 5 项 P2；`Priority` 顺序上都不影响正确性 |
| R3 P3 提到的 `deleted_at` `NULLS FIRST` 口径 | 属产品口味，需确认 |
| api-spec / int-spec | 会 drop 重建本地库；本轮沿用 R2 的 DTO 级回归 spec + R3 的真 PG 矩阵结论 |

---

## 8. 本轮改动文件（全部在 `apps/server/` + 1 份报告）

```text
M apps/server/apps/api/src/common/list-request-validation.spec.ts   # +3 priority 用例
M apps/server/libs/app-domain/src/logger/dto/logger.dto.ts          # 注释订正（方向反了）
M apps/server/libs/decorators/src/validator/base/number.validator.ts # optional 选项
M apps/server/libs/list/src/list.dto.ts                            # pageSize 常量 + priority 放宽 + 注释订正
M apps/server/libs/repository/src/pg-column-op.ts                   # 默认排序登记 + 日志降噪/去原值
M apps/server/libs/repository/src/pg-column-op.spec.ts              # warn 用例重写（4 条真断言）
M apps/server/libs/types/src/walnut-admin/decorators/number.d.ts     # optional 类型
M reports/batch-1/r2-be-implementation.md                           # P2-② 口径更正 + P2-① 补登记
A reports/batch-1/r3be-fixup.md                                     # 本文件
```
