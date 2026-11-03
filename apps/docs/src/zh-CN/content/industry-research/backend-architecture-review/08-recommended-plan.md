# 08 · 推荐实施方案（P0–P7）

> 前提：按 [07-DECISIONS.md](./07-decisions.md) 的 **6 条已定决策**执行。
> 排序原则：**先止血 → 再让门禁可信 → 然后才搬迁**。每一步可独立发布、独立回滚。
> ⚠️ **开工前置**：等并行线收工。原因：工作区当前 218 个文件在改，且原始 6 份报告已丢失，需按最终树重采。

---

## 阶段总览

| 阶段 | 主题 | 对应决策 | 工作量 |
|------|------|---------|--------|
| **P0** | 止血 + 建验证手段 | D1、D2 股①、D18③ | 2–3 人日 |
| **P1** | 门禁可信化（**搬迁的前置**） | D14、D18①②、D19、D17 | 3–4 人日 |
| **P2** | 建 `platform-node`（POC → 批量） | D4、D13 | 5–6 人日 |
| **P3** | list 契约换 wire | D2 股②、D15 | 4 人日 |
| **P4** | worker 真接线 | D3 | 2 人日 |
| **P5** | packages 收拾 | D6、D7、D8、D9、D20 | 4 人日 |
| **P6** | libs 结构债 | D11、D12、D10 | 4 人日 |
| **P7** | 数据与命名 | D5、D16 | 3 人日 |

**合计 ≈ 27–30 人日**。P0–P1（5–7 人日）完成之前不要动 P2。

---

## P0 · 止血

### P0-0 先给 admin 建一个最小 vitest runner（D18③）

**先做这一步，因为 P0-1 只能靠它验证。** admin 今天完全没有测试 runner，
这正是「动态 import 断裂能一路绿到线上」的结构性原因。

验收：`pnpm --filter @walnut/admin test` 能跑通一个空 spec。

### P0-1 删 `@walnut/ui` + 换显式注册表（D1）

1. 3 个组件（Switch / DynamicTags / TimePicker）搬回 `apps/admin/src/components/UI/`
2. 删包、删 `build/vite/plugin/component.ts` 里对 `@walnut/ui` 的扫描、删 `Form/src/types.ts` 里 3 个类型 import
3. **把 `componentMap` 的 4 个 `getXxxComponents()` 全部换成显式注册表**：
   常量映射 `type → () => import('具体路径')`，不再拼目录名

验收（必须是运行时）：
- 新 runner 加一条：遍历 `componentMap` 全部 key，断言 `BUILT_IN_FORM_ITEM_TYPE_*` 全量被覆盖
- 手工：DevSettings 面板、`/me/preference`、菜单编辑表单各开一次，Switch 正常
- `git grep -c "Base:Switch"` 的数量与注册表 key 一致

回滚：单 commit，纯前端，无数据面。

### P0-2 list 止血（D2 第一段）

1. 算子改**按列类型**选（读 `qb.expressionMap.mainAlias.metadata.columns`），不再按 `typeof value`
2. 值无法按列类型解释 ⇒ **400**，不落到 SQL
3. 给三个槽位打开 `ValidateNested`（「可空但存在则必须校验」），删掉 `list.dto.ts:51-55` 那段免责注释
4. `pageSize` 上限在 DTO 与 builder 各 clamp 一次

验收：
- 单测矩阵：{uuid, timestamptz, integer, boolean, text, jsonb} × {字符串, 数值, 布尔, 数组, 日期数组}
  ⇒ 要么正确 SQL，要么 400，**永不 500**
- 三个已知必现用例变 400：`{"query":{"id":"abc"}}`、`{"query":{"order":[1,2]}}`、`{"query":{"createdAt":"2024-01-01"}}`
- `validate()` 对 `pageSize=999999`、`sort.field=notAColumn` 必须返回错误（今天返回空数组）

**P0 不做的事**：不动 wire 形状（那是 P3），不动任何调用方。

---

## P1 · 门禁可信化（P2 搬迁的前置，不可跳过）

### P1-1 注册面生成化（D14）

- lib 清单变成**单一真源**（一个 manifest 文件）
- 由它生成：tsconfig paths、3 份 `infra/nest/*.json` 的 projects、3 份 swcrc、3 份 tsconfig.app include、
  **以及 ESLint 的 `files` 前缀**
- 3 份 431 行的 nest 配置合并为 1 份 base + overlay
- ESLint 分层**名单仍手写**（规则要可审），只把 `files` 路径生成化

验收：加一个假 lib 只需改 manifest 1 行 + 跑生成；drift spec 仍能拦住手工漏改；
34 条分层规则逐条验证仍生效（用故意 import 上层的负对照）。

### P1-2 两条门禁缺口（D18①②）

- `turbo.json` 加 `frontend` tag 规则（今天**一条都没有**）
- 3 个包的 barrel 从 knip `entry` 摘出，改专用「0 引用」脚本（报告模式两周 → 白名单 → 进门禁）

### P1-3 madge 进 prepush（D19）+ 文档订正（D17）

- 把 0 环结论纳入 prepush（今天 madge 只在 package.json 里躺着）
- 订正 `adr/zod-evaluation.md`（Nest 12.3.2 自带 standard-schema-validation pipe；admin 已在用 zod 4）

---

## P2 · 建 `platform-node`（D4）

### P2-A 单库 POC（**必须先做，成败决定后面怎么走**）

拿 `const`（27 文件、**0 处 Nest**、零外部依赖）搬到 `packages/platform-node/base/src/const`，
`@walnut-server/const` 的 paths 指过去，**所有 import 语句不改**。

验收四条必须同时通过：
1. `pnpm --filter @walnut/server build`
2. `pnpm --filter @walnut/server start:prod`（产物路径仍是 `dist/apps/api/src/main.js`）
3. `pnpm types:check`
4. `pnpm --filter @walnut/server openapi:export`（openapi.json 无 diff）

**若第 2 条失败**（dist 布局变了）→ 停下来找我：备选是这 2 个包像 `@walnut/contract` 一样构建 CJS dist（成本 M→L）。

### P2-B 批量下沉

    base/  @walnut/node-base  ← config const context db decorators pipes types utils + exceptions + blpath  (10 库)
    tech/  @walnut/node-tech  ← als cookie crypto lock queue sse cache throttle mailer sms rsa ip
                                + repository list crud scope-resolver token                                  (18 库)

`apps/server/libs/` 只剩 identity / system / auth / security / guards / app-domain（6 库）。

同时完成 D13 的修订版：删 `delay`（死库）、`context` 并入 `als`。

验收：`pnpm boundaries` + `pnpm lint` + `pnpm types:check` + `pnpm build` + `pnpm test` 全绿；
P1-1 的负对照（故意 import 上层）仍然红。

回滚：`git mv` 可整体回退；因为 import 零改动，回退只需改 paths 生成的目标。

---

## P3 · list 契约换 wire（D2 第二段 + D15）

- `filters: [{field, op, value}]`，`op` 白名单由列类型决定；`op` 不再由值类型推断
- 换掉 `contract/src/pagination.ts` 的 `query?: T`（它把 ORM 实体形状抬进了跨端契约）
- 默认排序追加 `id` 兜底（解决同毫秒行 offset 分页漏行/重行）
- 改动面：21 个 controller + 前端 1 个参数构造点 + 16 个 `.vue`

验收：`openapi.json` 与 `schema.d.ts` 重新生成且 diff 可读；每个端点至少一条 api-spec；前端 3 个代表性表格页手工回归。

---

## P4 · worker 真接线（D3）

1. 镜像第二入口（同镜像不同 CMD）或独立 Dockerfile stage
2. 编排加 worker service（复用同一镜像）
3. CI 冒烟：启动 worker 上下文，断言 cron jobs 数量 > 0（`main.ts` 已经打出这个数字）
4. `WORKER_STANDALONE` 语义写进文档（未设置时 api 行为逐字节等价）
5. 「cron 只允许单实例」（ADR 0025）写进编排注释

验收：CI 冒烟绿；本地 `pnpm start:worker` 起来后手动确认 cron 数与日志。

---

## P5 · packages 收拾（D6 / D7 / D8 / D9 / D20）

1. 删 platform-web 三个桶入口（`client` / `http` / `ui`），只留子路径；改 ADR 0013
   （**api-types 的桶要保留** —— 它是 78 个文件的唯一入口）
2. `@walnut/types`：`walnut.platform` 改 `web`，改 description
3. `@walnut/utils` 收缩：16 个浏览器专用值下沉 `platform-web/client`，只留 `sign-raw` + `object-paths`
4. `api-types` 挪到 `packages/generated/api-types`；`openapi:check` 拆两段
5. TinyMCE 移出 `apps/api/src/public/`（-4.08MB 出镜像）

---

## P6 · libs 结构债（D11 / D12 / D10）

1. 分布式锁端口化：`WALNUT_ADMIN_LOCK` + `WalnutLockService`，murlock 作适配器，10 处改注入
2. `libs/cache` 域缓存显式化：8 个域缓存改名 `<domain>.cache.ts`，ADR 0022 登记例外
3. Repository 三模式 → 两模式；`@Global` 改用「消费方 ≥2」机械判据

---

## P7 · 数据与命名（D5 / D16）

1. `roles_list` / `roles_count` 永久冻结（只写文档）
2. `/system/locale/list` 的 `id` → `groupKey`（1 接口 + 1 页面 + schema 再生成 + 1 测试）
3. seed 重建：`db:export:pg` 机械再生成行形态；`ejson.ts` 降级为历史导入兼容器；`seed-map.ts` 退役
   验收 = 新旧两套各灌空库、逐表 diff **全等**

---

## 范围红线

- 不重构 `apps/api/src/modules` 的业务分区（除 D20 与 `common/` 局部改名）
- 不改认证/安全链路（Guard 顺序、OPAQUE/WebAuthn/MFA）
- 不改数据库 schema 语义（除 D16 的响应字段改名与 D5 的 seed 形态）
- 不为「让 packages 看起来完整」制造没有消费方的包

---

## 最后一条工程建议

三个 P0/P1 是**同一类失败**：机制存在，但没有东西在检查它是否起作用。
- `componentMap` 的路径约定 → 没有测试/构建检查
- list 三槽位校验 → 声明了但 `required: false` 让它失效
- `pnpm boundaries` → 4 条规则 2 条不可能触发
- knip → 把 barrel 当公共 API，死导出永不可见

所以 **P1（门禁可信化）不是卫生工作，它是唯一能防复发的东西** —— 也因此排在搬迁之前。
