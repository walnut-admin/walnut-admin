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

## 2. NestJS 12：✅ 已升级（2026-10-29，12.3.2）

**事实（2026-10-27 核验）**：v12 正式版 2026-08-28 发布（Trilon 公告），npm latest 12.3.2；
v11 仍在维护（11.2.8，2026-10-23）。**Standard Schema 是加法不是替换**：
`@Body({ schema })` + 内置 `StandardSchemaValidationPipe`（无 schema 的参数直接透传，可增量采用），
class-validator 通道完整保留；配套 `StandardSchemaSerializerInterceptor`；
`@nestjs/config` 的 validationSchema 也接受 Standard Schema（Joi 用户需升 Joi 18）。
Swagger 缺口：@nestjs/swagger 仍无官方 zod→OpenAPI 一等支持——这是本仓不迁 zod 的最实际理由。

**升级执行记录（2026-10-29，分支 refactor/postgres-migration）**：

- **catalog 锁步**：common / core / platform-express / platform-socket.io / websockets / testing → 12.3.2；
  swagger 12.0.5、terminus 12.1.0、config 12.0.1、jwt 12.0.3、passport 12.0.0、cache-manager 12.0.2、
  event-emitter 12.0.1、schedule 12.0.2、bull 12.0.0、axios 12.0.1、cli 12.0.11、schematics 12.0.12；
  throttler 停留在 6.7.1（上游无 12 major，peer 已覆盖 ^12）；@nestjs/typeorm 12.0.2 不动；
  nest-winston 1.10.2 → 2.0.0（peer 覆盖 common ^11 || ^12）。全仓 17 个 package.json 的 engines
  同步上调 `node >=24.15.0`（schematics 12 要求 ^24.15.0）。
- **适配器轴零改动**：保留 platform-express，不引入 platform-node（Express 5.2.1 → 5.3.0 是小版本）；
  main.ts 的 trust proxy / hbs `@Render` / `useStaticAssets` / Scalar mount / SSE 全保持。
  Nest 12 全家改为 **ESM-only**（`"type": "module"`），CJS 应用靠 Node 24 的 `require(esm)` 承载，
  本仓不迁 ESM、SWC 仍产 CJS（构建与运行均验证通过）。
- **Terminus**：本仓没有继承 `HealthIndicator` 的自定义指示器；四个内建指示器（http/typeorm/memory/disk）
  在 12.1.0 仍以类导出且方法签名不变 → `health.controller.ts` **零改动**。Terminus 12 的
  `HealthCheckService` 错误语义（抛错 → 500、仅返回 down → 503）不影响本仓端点——它们直接返回指示器结果，
  不经过该服务。
- **编译期适配 9 处（全部类型层，wire 零变化）**：
  ① `@nestjs/swagger` 12 的 exports map 只开 `.` / `./plugin`，三处 `dist/interfaces/*` 深导入改包根
  （`EnumAllowedTypes` 未公开导出，由 `ApiPropertyOptions['enum']` 反推）；
  ② `ClassSerializerInterceptor.intercept` 返回类型变为 `Promise<Observable>` → loose.interceptor 加 async；
  ③ ThrottlerGuard 6.7 基类新增 `protected logger` → 两个自建 guard 的 `private logger` 改 protected；
  ④ `IoAdapter.createIOServer` 第二参变可选 → socket.adapter 改为合并 options（行为不变）；
  ⑤⑥ nestjs-i18n 与 @nestjs-modules/mailer 的 `*AsyncOptions`（`Pick<ModuleMetadata,'imports'>`）
  在 Nest 12 类型图下 imports 变必填 → 各补 `imports: []`；
  ⑦ socket.io 4.8.3 → 4.8.4（platform-socket.io 12 依赖 4.8.4，不锁步会出现两份类型）；
  ⑧ `@nestjs/swagger` 的 `SchemaObject` / `ReferenceObject` 改包根导入；
  ⑨ 上述 socket/guard 相关的类型收口（`options as ServerOptions`、返回类型显式 `Server`）。
- **上游缺陷 1 条（已在 pnpm-workspace.yaml 兜底）**：`@nestjs/platform-express@12.3.2` 的 ESM 产物
  `multer/multer.utils.js` 静态 import `rxjs`，但 package.json 的 dependencies / peerDependencies 均未声明；
  `hoist: false` 下从该包位置解析失败，启动即 `Cannot find package 'rxjs'` → 用 `packageExtensions`
  给它补 `rxjs: '*'` peer（pnpm 会把工作区 rxjs 链进同一虚拟存储目录）。
- **第三方 peer 结论**：`@nestjs-modules/mailer` 2.3.4（core >=7 / terminus >=10）、`nestjs-i18n` 10.6.0
  （core/common `*`）、`@scalar/nestjs-api-reference` 1.1.5（无 peer）、`@socket.io/admin-ui`（仅 socket.io）、
  `bull` 4.16.5 全部兼容。唯一残余告警：terminus 的可选 peer `@nestjs/mongoose@11.0.4` 自身 peer 只到
  Nest 11——本仓不使用 mongoose、该 opt-in 集成不装载，按 `strictPeerDependencies: false` 既有口径接受。
- **行为差异登记**：
  - 运行时无行为差异（生命周期钩子「按层级调用」在本仓无顺序依赖——`onModuleInit` 只有
    AppTechTaskModule 与 Redis 两处；`@Optional` 仓内零使用；健康检查/限流/队列/会话链路
    全量集成测试 485 例通过，socket.io（Gateway 启在配置端口 + `hello` 订阅）与 bull 队列
    （BullModule 初始化 + task 六条 cron 任务 onModuleInit 全跑）启动日志级冒烟通过）。
  - **openapi 产物有 schema 级增量（非注释级）**：Terminus 12 的 `@HealthCheck` 现在会给端点
    补 200/503 响应文档（`@nestjs/swagger` 存在时），openapi.json 5 个健康端点各 +~220 行、
    schema.d.ts 同步 +660 行；属上游文档化增强，wire 不变，生成物已重导出。
  - **偶发**：首轮全量集成曾出现 `concurrency.api-spec` G6（key rotate 并发）一次失败
    （`expected 3 to be 1003`）；该文件单独复跑与随后两轮全量均通过，未见稳定复现——
    登记为测试时序敏感观察项（该用例本身断言并发时序），非编译期问题、未修。
- **Joi**：本仓 env 校验是 class-validator（`libs/config/src/validation.ts`），不涉及 Joi，无动作。

## 3. 接口类型共享：OpenAPI codegen（✅ 一期 / 二期 / 收尾批均已落地）

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
- 分期执行记录：第一期（2026-10-28）导出脚本 + 生成包 + 镜像漂移止血 + menu 全链；
  **第二期（2026-10-28）全模块替换落地** —— `api-types/src/index.ts` 按模块铺齐生成别名
  （命名对齐原 IModels.X，逐名平移），admin 57 个引用文件全部改 import 生成别名，
  `models.d.ts` 删除、`response.d.ts` 收缩到只剩不可推导形状（server 无 schema 的端点 /
  生成过松的 WebAuthn options / 变换层形状），CRUD 组件 `BaseAPIType` 约束同步切
  `{ id: string }`。server 侧唯一改动：lock/read 装饰器从谎报的 `primitive: 'boolean'`
  改为真实 `DTO: SysUserLockPreferenceDTO`（wire 零变化）；其余 swagger 缺口
  （process/isArray/fontSize never/id 虚构等 8 条）登记 DESIGN-ISSUES P3-9~P3-16。

- **收尾批（2026-10-29，admin 侧 `IResponseData` 清零）**：
  ① **无 schema 端点补文档化（wire 零变化）** —— `/app/monitor/server/*` 八个端点
  （`AppMonitorServerDTO*` 只文档化 service 逐字段投影的 systeminformation 子集）、
  `/deps`（`AppBackendDepsResponseDTO`，`additionalProperties: { type: 'string' }`）、
  `/app/key/current/:type`（`AppKeyCurrentResponseDTO`，publicKeyPem / keyB64 双形态
  optional）、`/security/sign/aes-key`（信封字符串标注）、`/system/lang/list/public`
  （`SysLangDTOListPublicResponse[]`）、`/system/device/initial`
  （`SysDeviceDTOInitialResponse` 按 wire 收窄）、`/app/logger/:logType/:fileName`
  （`AppLoggerReadResponseDTO`）、`/shared/ali/sts`（三敏感字段信封标注）、
  `/auth/keys`（`AuthSecretKeysResponseDTO` —— 收尾批核对时发现的第 9 个无 schema 端点）。
  ② **WebAuthn options** —— server 侧按 @simplewebauthn 的
  `PublicKeyCredentialCreationOptionsJSON` / `RequestOptionsJSON` 逐字段建 DTO
  （字符串枚举 inline 收窄，`options` 刻意不挂 `@Type` 保持 wire 原样透传），admin 生成
  类型可直接喂 `startRegistration` / `startAuthentication`。
  ③ **不可推导形状迁出** —— `Auth.Permissions`（RouteRecordRaw/TreeNodeItem 变换层）、
  `SettingPublic/Private`（Partial store 消费）、`SecurityTab2/3`（server `data:null`）、
  `User.Preference`（fontSize never）迁入 `apps/admin/src/api/types/frontend-shapes.ts`
  并逐条注明「真源=消费组件」，`api/response.d.ts` 删除。

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

1. ~~NestJS 12 升级窗口~~：✅ 已于 2026-10-29 执行（12.3.2，见 §2 执行记录）。
2. **OpenAPI codegen**：✅ 一期已落地（2026-10-28）——导出脚本 + @walnut/api-types 生成包 + 镜像漂移止血 + menu 全链；✅ 二期已落地（2026-10-28）——全模块替换 IModels + models.d.ts 退役 + IResponseData 收缩；✅ 收尾批已落地（2026-10-29）——无 schema 端点补文档化 + WebAuthn options typed DTO + 不可推导形状迁 `frontend-shapes.ts`，`IResponseData` 清零（见 §3 执行记录）。
3. **ETL 工具链去留**：✅ 已落地（2026-10-28）——正名而非封存（见 §4.1 末），seed 通道组件保留。
4. **L1 命名清理窗口**：✅ 已于 2026-10-28 执行（在 sys_deleted 存量为 0 的窗口内完成，见 §4.1 L1 执行记录）。
5. ~~admin 闲置 zod 依赖~~：勘误消除——zod 在 admin 构建配置真实使用（见 §1 勘误），不处置。

## 6. 文档大轮次复审修复决策记录（2026-10-28 维护者拍板）

> 文档撰写复审新发现 38 条（DESIGN-ISSUES P0-6、P1-13~19、P2-11~31、P3-17~30）。
> 本节记录拍板结果；未列入者维持 DESIGN-ISSUES 登记，按 backlog 排期。

| 簇 | 条目 | 决策 | 状态 |
|---|---|---|---|
| 安全急修 | P0-6 key 私钥暴露 | **修**：current/:type 加权限，响应永不下发私钥（前端只需公钥） | ✅ 已实施 2026-10-28 |
| 安全急修 | P1-15 权限缓存 TTL×1000 | **修**：TTL 单位修正 | ✅ 已实施 2026-10-28 |
| 安全急修 | P1-16 OTP 动态限流失效 | **修**：元数据键修正 | ✅ 已实施 2026-10-28 |
| 产品口径 | P1-13 risk 阻塞失效 | **口径定为「风险只触发 CAP」**：摘除 shouldBlock 幻觉字段，guard 吞异常修正 | ✅ 已实施 2026-10-28 |
| 产品口径 | P1-14 opaque register | **语义定为「已登录用户补挂口令」**：按 userId upsert password identity，不再按用户名查重 | ✅ 已实施 2026-10-28 |
| 产品口径 | P1-17 Google 登录重复建用户 | **端点暂时关闭**（Functional 开关默认关）；补全（写 identity/oauth、同邮箱复用）为后续功能开发 | ✅ 已实施 2026-10-28 |
| 会话安全 | P2-13 OAuth state 无签名无一次性 | **修**：state 补签名 + 一次性校验，堵登录 CSRF | ✅ 已实施 2026-10-28（批 C） |
| 会话安全 | P2-15 永久黑名单零配置不积累 | **修**：seed 落 `app.global.ipBlackList` 显式默认行 | ✅ 已实施 2026-10-28（批 C：seed 行已在 + check-seed 机械核对） |
| 会话安全 | P2-12 踢下线后 AT 残留 | **修**：force-quit/kick 链路补会话与权限缓存清扫（配合 P0-4 会话校验，AT 立即失效） | ✅ 已实施 2026-10-28（批 C） |
| 数据一致性 | P1-18 角色脱钩权限残留 | **修**：roles 变更同步校正 current_role_id 并失效权限缓存 | ✅ 已实施 2026-10-28（批 D） |
| 数据一致性 | P1-19 user create/update 无事务 | **修**：补 @WalnutTx（对齐 role 写路径） | ✅ 已实施 2026-10-28（批 D） |
| 数据一致性 | P2-16 角色/菜单变更不清权限缓存 | **修**：变更失效 `AUTH:PERMISSIONS` | ✅ 已实施 2026-10-28（批 D） |
| 数据一致性 | P2-18 恢复用户不恢复外围 | **修**：恢复联动 identity/preference 等外围数据 | ✅ 已实施 2026-10-28（批 D：五张外围表联动；junction 仍登记） |

其余新发现（P2-11 nonce 并发窗、P2-14 并发 login 判据、P2-17 lang 缓存不对称、P2-20 菜单树无权限、
P2-21~29、P2-32 security-policy 不清会话、P3-17~30 等）**维持登记、按 backlog 排期**，本轮不修。

### 6.1 数据权限一期（2026-10-30 实施完成）

方案与决策真源：`docs/plans/data-scope-design.md`（§4 推荐方案、§5 实施状态、§7 四机制）。

落地要点：

- `sys_role.data_scope`（1 ALL / 2 SELF / 3 CUSTOM；root=ALL、visitor=SELF）、
  `app_demo.created_by` 示范 owner 列；迁移可逆，dev 库手工 ALTER 保数据。
- 应用层 scope 收口到 `common/repository/pg-base.repository.ts`：list / readById /
  updateByField / deleteSoft* / deleteSoftManyByCondition 全部注入参数化谓词；
  create 自动填 owner；覆写 list 的三个模块显式调用。
- 实体注册表 fail-closed（7 张业务表注册 + 其余逐条豁免）；ALS 拦截器种
  `userId + dataScope`；`AUTH:DATA_SCOPE:<userId>` 缓存 + 五类失效点。
- 机械守卫：注册表完整性单测（每张实体表必须分类）+ ESLint
  `no-restricted-syntax`（已注册实体直连必须显式豁免）。
- admin 角色表单新增 dataScope 选择器；OpenAPI/生成类型同步（`SysRoleDTOSafe.dataScope`）。
- 测试：解析器矩阵 / 缓存失效 / 注册表守卫 / 基类注入（真 PG）/ demo 模块 API 级
  SELF-CUSTOM-ALL 与越权 404 用例。

二期（部门维度 + RLS RESTRICTIVE 硬上限）按 §4 二期清单另行排期。

### 6.2 数据权限三期（RLS RESTRICTIVE，2026-10-30 实施完成）

- 七张注册表 `ENABLE + FORCE ROW LEVEL SECURITY`；每表一条 PERMISSIVE 基线 +
  一条 RESTRICTIVE 天花板（`app.data_scope_*()` STABLE 函数读事务级 GUC）。
- 运行时连接切 `walnut_app`（NOSUPERUSER NOBYPASSRLS）；`DATABASE_PG_APP_USER/PASS`
  **显式必填**（缺失启动报错，禁止回退管理角色）。
- 事务级注入：`@WalnutTx` 拦截器在 `startTransaction` 后写 GUC；基类仓库对注册实体
  无 em 时自动事务；系统读腿（登录链 / guard / 日志旁写 / 心跳）显式走 system 事务。

**部署注意（生产必读）**：

- `walnut_app` 必须**预建**并配置强密码（与 `DATABASE_PG_APP_USER/PASS` 一致）：
  迁移里的 `CREATE ROLE` 只是本地/集成库引导，角色已存在时跳过、不会覆盖生产密码。
- 管理通道 `DATABASE_PG_USER`（迁移 / `db:export:pg` / seed / 测试 fixture）必须是
  superuser 或 BYPASSRLS，否则 RLS 表（FORCE）会被默认拒绝。
- 生产 / 预发 env-encrypted 必须含 `DATABASE_PG_APP_*`；缺失时应用启动即报错。
