# 现代化路线图（迁移后时代）

> 真源文档：`postgres-migration-phase2.md`（表结构）、`postgres-migration-phase3-plan.md`（迁移执行）、
> ADR 0021（决策）。本文件收编迁移完成后的调研结论与待办排期（2026-10-27）：
> 校验栈结论、NestJS 12 升级计划、接口类型共享（codegen）、遗留架构清单。
> 行为级缺陷清单独立维护在 `apps/server/apps/api/test/api/DESIGN-ISSUES.md`。

## 1. 校验栈结论：class-validator + class-transformer 保留（2026-10-27 调研定稿）

**结论：不迁 zod，不换范式，两库均已在 npm 最新版（0.15.1 / 0.5.1），无升级动作。**

- 职责边界：TypeORM 管持久化，对 HTTP 入参不设边界；class-validator 管输入白名单
  （`whitelist + forbidNonWhitelisted` → 未声明字段 40099 报错而非静默剥离）；
  class-transformer 管输出白名单（`excludeExtraneousValues` + `@Expose`）。
  三件事与 DB 无关，换 PG 不改变需求。
- 强校验语义现状（全部有测试护航）：入参未声明 = 报错；出参未 `@Expose` = 不出现；
  `exposeUnsetFields:false`（没给的字段不材料化成显式 undefined）；
  `skipMissingProperties:false`（undefined 必填即 40099）；`@IsOptional` 对 null/undefined 双跳过。
- class-transformer 上游五年未发版（0.5.1，2021-11），是长期事实但 NestJS 生态仍全面依赖，
  无行动必要。class-validator 2026-02 仍在发版，健康。
- 未来 bump 时的验证清单：`types:check` 先红装饰器签名 → 全量 431 测试 →
  定点回归四处（40099 白名单报错形状 / undefined 材料化 / IsOptional 双跳过 / RealPickType 派生）。
- zod 重审触发条件：① 升 NestJS 12 后 @nestjs/swagger 出一等 zod→OpenAPI 支持；
  ② admin 决定引入前端运行时校验并要求前后端 schema 同源。
  （勘误 2026-10-28：早前「admin 的 zod 依赖零引用属闲置」记载有误——zod 在
  `apps/admin/build/vite/config/shared.ts` 用于 VITE_PROXY 环境变量校验，已在
  devDependencies，非闲置、不处置。initial 调研只扫了 src/ 漏了 build/。）

## 2. NestJS 12：已 GA，不建议现在升，开独立窗口（1-2 个月内）

**事实（2026-10-27 核验）**：v12 正式版 2026-08-28 发布（Trilon 公告），npm latest 12.3.2；
v11 仍在维护（11.2.8，2026-10-23）。**Standard Schema 是加法不是替换**：
`@Body({ schema })` + 内置 `StandardSchemaValidationPipe`（无 schema 的参数直接透传，可增量采用），
class-validator 通道完整保留；配套 `StandardSchemaSerializerInterceptor`；
`@nestjs/config` 的 validationSchema 也接受 Standard Schema（Joi 用户需升 Joi 18）。
Swagger 缺口：@nestjs/swagger 仍无官方 zod→OpenAPI 一等支持——这是本仓不迁 zod 的最实际理由。

**升级破坏面 × 本仓对照**：大半已被现有技术栈天然扫掉（Node 24 ✓、TS 6 ✓、SWC 非 webpack ✓、
无 GraphQL/NATS ✓、@nestjs/typeorm 已 12 ✓、rxjs 7.8 ✓）。真实工作量：

| 项 | 说明 |
|---|---|
| @nestjs/* 全家锁步升 12.x | catalog 里 15 个包一次升（含 swagger/terminus/config/schedule/throttler 等）；@nestjs/typeorm 12.0.2 已就绪不用动 |
| Terminus 旧 API 移除 | 继承 `HealthIndicator` 改注入 `HealthIndicatorService`——可在 v11 上提前改（v11 后期已支持） |
| Node engines 上调 | CLI/schematics 要求 ≥24.15，engines 与 CI 镜像同步 |
| 自定义管道签名细化 + 生命周期钩子按层调用 | `libs/pipes` 小改；靠 431 测试兜底 |
| @nestjs/config + Joi | 确认 env 校验是否用 Joi（是则升 Joi 18 或 `libraryOptions`） |
| 第三方 peer 核对 | mailer / i18n / winston / scalar 等 `pnpm why` 逐个过 |

**前置条件清单（可在 v11 上先行）**：① Terminus 指示器改写；② engines 上调；
③ Joi 确认。然后独立分支一次锁步升 12，全量 431 测试 + 构建 + socket/bull 冒烟。
预估 1-1.5 人日，拆两个 PR（前置整理 / 锁步升级）。

## 3. 接口类型共享：OpenAPI codegen（待启动，即原「批 6」）

**推荐方案（2026-10-27 调研定稿）**：server 补 swagger.json 导出（现只有 Scalar UI 无裸 JSON，
`documentFactory` 已现成）→ 新增 `packages/platform-web/api-types` 生成包
（openapi-typescript，types-only 零运行时，生成物 check-in + CI `git diff --exit-code` 拦漏生成）
→ admin `BaseAPI` 泛型从 `IModels.Base` 松绑为 `{ id: string }`，逐模块替换 `models.d.ts`
（304 行手工镜像已实测 3 处漂移，57 文件约 220 处引用），最后删镜像。

- `Recordable`/object 字段（menu watermark、deleted content、lockRoute、deviceInfo 等约 5-8 处）
  生成松散类型，需补 `additionalProperties` 或手写 override。
- **contract 包定位不变**：只放两端运行时共享物（枚举 / response code / Routes / Socket 事件 /
  跨端纯类型如 `IWalnutAdminMenuMeta`）；接口级入参出参类型 100% 可从 swagger 派生，
  **不进 contract**（手写进 contract 等于把镜像漂移升级到包级别）。
- 分期：第一期导出脚本 + 生成包 + 修 3 处漂移 + menu 模块走通全链；
  第二期全模块替换 + IResponseData 退役 + prepush 加一致性门禁。

## 4. 遗留架构清单（Mongo 时代设计在 PG 下的适应性审计，2026-10-27）

> 审计范围排除 DESIGN-ISSUES 已登记的行为缺陷。结论：行为层几乎干净，
> 真正的遗留集中在**命名词汇层**（窗口型收益）与**万能列表的索引对齐**（渐进型收益）。

### 4.1 值得排期（Top 3，全部中等收益，无高优必须项）

| # | 项 | 内容 | 成本 | 窗口性 |
|---|---|---|---|---|
| L1 | **de-Mongo 命名清理打包 PR**（✅ 已执行 2026-10-28） | `populated_*` 键名（两端同步，约 8 个 admin 文件 + 15 个测试文件 + 漂移守卫）；`correspondingMS` 顺路；`WalnutDBTransaction/Session` → `WalnutTx*`、`WalnutDBModelName` 族改名。**关键窗口：modelName 的值（'SysUserModel' 等）已写进 sys_deleted 快照行——趁本地存量为 0 现在改名最便宜，拖久成本上升**（执行记录：全族 `populated_*` 去 populate 前缀、`WalnutDBModelName`→`WalnutModelName` 且 24 值去 Model 后缀、`WalnutTx`/`WalnutTxSession`、`correspondingMS`→`durationMs` 列名不动） | M | ★ 时间窗口型 |
| L2 | **listAggregate sort 收紧** | 各列表 DTO 的 sort 白名单收敛到有索引支撑的列集；高频模糊字段按需补 trgm GIN（全库仅 sys_locale.key 一个）。`{query,sort,page}` 契约本身不动（前端 table 组件长在上面） | S~M/实体 | 渐进型 |
| L3 | **appSettings 读取小手术** | `getSetting` 每调用 `JSON.parse` 整对象且每请求都过 functional.guard——进程内 memo + 写后失效（复用现有 after-commit 钩子时序）；LISTEN/NOTIFY 多实例失效列可选后续 | S | 随时可做 |

ETL 工具链处置（2026-10-28 已落地，正名而非封存）：核实发现 etl-map/uuid5 是 seed-pg/
export-pg 的**活依赖**（同一映射层），「封存」不成立；已正名——`etl-map.ts → seed-map.ts`
（导出符号 EtlMap*→SeedMap*、ETL_*→SEED_*）、`WALNUT_ADMIN_ETL_NAMESPACE →
WALNUT_ADMIN_UUID_NAMESPACE`（值不变，v5 派生确定性不受影响）；ETL 驱动脚本与
db:etl/db:verify-etl 通道早在 5a 已删。现状：`seed-map/ejson/uuid5/seed-pg/export-pg`
是纯 seed 通道组件，无 ADR 真空残留。

### 4.2 明确不动（含理由）

| 项 | 不动理由 |
|---|---|
| HTTP 恒 200 + body.code 信封 | 与 Mongo/PG 无关的项目自始契约；前端三个适配器（retry/cache/throttle）、错误码 i18n、加密/SSE 特例全部长在上面；可观测性损失真实但换不回 L 级两端改造。对外 API 应另起版本化通道 |
| 软删快照单表 jsonb + modelName 路由 | PG 下无更优替代（per-table archive×22 更差、PG 无内置 system versioning）；恢复事务化 + 并发实测已闭环。唯一观察点：长期膨胀按 modelName 分区，量级未到 |
| uuid v5 存量主键 | v5 与 v4 同为均匀随机，无额外 B-tree 碎片；业务表小、大表（area 66 万）静态、追加型表已 uuidv7——分层决策当时做对了，补救无对象 |
| ON CONFLICT 单行 upsert 表 | 已是 PG 习惯用法范本，并发实测无死锁（G4） |
| murlock/Redis 锁主体 | 4 处中 3 处保护跨实例 Redis 状态机（sign 票据 / failedLogin 恰好一次 / lock guard），PG advisory lock 反而让锁与被保护状态分居两系统。唯一可收敛：device.guard 的 IP 写改单条幂等 UPDATE（S，低优） |
| shared_area 不上 ltree | 真实查询形态是逐级下钻（pcode 等值），btree 已最优；整子树拉取任何索引都救不了；CTE+CYCLE 正确且有环保护。未来出现前缀搜索需求再评估 |
| socket/bull/mailer 周边 | rg 证实零 Mongo 耦合 |
| `correspondingMS` 单字段 | 已有书面决策（B8），admin 在读，单字段改名收益≈0；✅ 已随 L1（2026-10-28）顺路改 `durationMs`（列名 `corresponding_ms` 不动，零迁移） |
| @WalnutDBTransaction 命名 | 纯命名层；✅ 已随 L1（2026-10-28）改为 `WalnutTx` / `WalnutTxSession` |

### 4.3 已完成的相关修复（本次，13a593e）

六项校验瑕疵闭环：logger 路径穿越封死（枚举+文件名白名单管道 + resolve 包含性断言）、
PG 23514 映射受控 40000、裸奔 param/query 加管道四件（顺带修 ParamEnum optional 形态 bug）、
枚举三方守卫入 drift spec（抓出并修复 `ck_menu_cache_key_strategy` 缺 `custom` 的真实不一致）、
`/state` 异常悬挂修复（shouldSkip 语义收窄为「不观察」，异常壳恒落盘）、locale 管道放宽与
cap/SSE 无壳面登记（P2-10 / P3-8，DESIGN-ISSUES 现 35 条）。

## 5. 决策待办（需要维护者拍板）

1. **NestJS 12 升级窗口**：建议 1-2 个月内独立分支执行（前置清单见 §2）。
2. **OpenAPI codegen 第一期**：✅ 已落地（2026-10-28）——导出脚本 + @walnut/api-types 生成包 + 镜像漂移止血 + menu 全链；二期（全模块替换 IModels/IResponseData 退役）待排期。
3. **ETL 工具链去留**：✅ 已落地（2026-10-28）——正名而非封存（见 §4.1 末），seed 通道组件保留。
4. **L1 命名清理窗口**：✅ 已于 2026-10-28 执行（在 sys_deleted 存量为 0 的窗口内完成，见 §4.1 L1 执行记录）。
5. ~~admin 闲置 zod 依赖~~：勘误消除——zod 在 admin 构建配置真实使用（见 §1 勘误），不处置。
