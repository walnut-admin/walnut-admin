# 批次 12 · D 组结构债 · R1 深度调研

> 只读轮：**未改任何源码 / 未改任何 spec**。结论均可按附录 A 复跑。产出物只有本文件。

## 0. 环境与口径（先记两处与任务书不一致）

| 项 | 任务书 | 实测 | 备注 |
|---|---|---|---|
| HEAD | `e90cb37f` | **`bf3c1c1d`** | `git rev-parse --short HEAD`；`git status --porcelain` 为空（clean） |
| 后端基线 | — | 8 文件 / **41 tests 全绿**，exit 0 | `cd apps/server` 后跑 `cmd /c "pnpm exec vitest run --config ./apps/api/vitest.config.ts common/monorepo"`（3.39s） |

基线逐文件（本轮实测）：

```
✓ common/monorepo/lib-registration.drift.spec.ts (9 tests)
✓ common/monorepo/verify-build-assets.spec.ts (4 tests)
✓ common/monorepo/guard-order.drift.spec.ts (4 tests)
✓ common/monorepo/route-catalog.drift.spec.ts (7 tests)
✓ common/monorepo/device-id-form.drift.spec.ts (2 tests)
✓ common/monorepo/worker-import-closure.drift.spec.ts (5 tests)
✓ common/monorepo/core-module-scope.drift.spec.ts (7 tests)
✓ common/monorepo/repo-global.drift.spec.ts (3 tests)
Test Files 8 passed (8) | Tests 41 passed (41) | exit 0
```

判据真源：`apps/server/AGENTS.md`「Repository 与 Shared Service（两种形态，一个判据）」表格 + 该节正文
「**`@Global` 只有一个判据：消费方模块数 ≥ 2**」。

---

## 1. Q1 —— `SysLogAuthSharedModule` 的现状与判定

### 1.1 它提供什么

`apps/server/libs/system/src/logs/auth/shared/log.auth.shared.module.ts:12-18`

```ts
@Global()                                          // :12
@Module({
  imports: [SysLogAuthRepoModule],                 // :14
  providers: [SysLogAuthSharedService, Reflector], // :15
  exports: [SysLogAuthSharedService],              // :16
})
```

- 唯一对外导出：`SysLogAuthSharedService`（`log.auth.shared.service.ts:39`）。
- 该 service **有真实业务逻辑**：`recordAuth` 拼 i18n 文案 → 百度 IP 定位 → 落 auth 日志 → 失败时触发风控收集
  （`:93-144`）；4 个构造参数（`:42-48`）：`Reflector`、`SysLogAuthRepoService`、`SharedIpService`、
  `WALNUT_ADMIN_SYSTEM_FAILED_LOGIN_RISK_COLLECTOR` 端口。
- 按 AGENTS.md 表格 ⇒ **Shared Service 形态**（不是 Repository）：`imports` 里无 `TypeOrmModule.forFeature`，
  providers 里**无任何 `{ provide: TOKEN }` 端口绑定**（扫描 `tokenBind=false`）⇒ 不适用 ADR 0022 D3 例外。

### 1.2 谁注入它（3 个类，全落在 1 个模块）

| 注入点 | 形态 | 宿主模块 |
|---|---|---|
| `libs/guards/src/decorators/log.auth.decorator.ts:20` | 构造器注入（`WalnutAdminInterceptorRequestAuthLog`） | 由 `@UseInterceptors` 自动插入**宿主 controller 所在模块** |
| `libs/guards/src/guards/auth.guard.ts:23-24` | **属性级** `@Inject`（`WalnutAdminGuardAuth(strategy)` mixin 内） | 各子类被声明处的模块 |
| `apps/api/src/modules/auth/modules/opaque/user/opaque.user.controller.ts:32` | 构造器注入（唯一直接注入的 controller） | `AuthHttpModule` |

三者宿主全部是**同一个文件** `apps/server/apps/api/src/modules/auth/auth-http.module.ts`：

- `controllers:` `:64-74`（9 个），其中挂 `@WalnutAdminDecoratorAuthLog` / mixin guard 的 5 个：
  `OtpController`(:67)、`AuthGoogleController`(:68)、`AuthOpaqueUserController`(:69)、
  `OAuthGiteeController`(:72)、`OAuthGithubController`(:73)；
- `providers:` `:75-86`，5 个 mixin guard：`AuthGoogleGuard`(:76)、`AuthOpaqueUserGuard`(:77)、
  `OAuthGiteeGuard`(:78)、`OAuthGitHubGuard`(:79)、`OtpGuard`(:81)。

### 1.3 消费方**模块数** = 1（机械复算，不是数文件）

按判据口径（"声明了注入该 service 的类的模块数"）静态复算，把 ① `providers[]` ② `controllers[]`
③ **属性级 `@Inject`**（mixin guard 的写法）都算进去：

```
### SysLogAuthSharedService
  declaring module(s): ["libs/system/src/logs/auth/shared/log.auth.shared.module.ts"]
  injecting files (2): ["apps/api/src/modules/auth/modules/opaque/user/opaque.user.controller.ts",
                        "libs/guards/src/decorators/log.auth.decorator.ts"]
  consumer MODULES (1): ["apps/api/src/modules/auth/auth-http.module.ts"]
```

（`auth.guard.ts` 的属性级 `@Inject` 没出现在 injecting files 里是扫描口径问题，不影响结论：
它的 5 个子类全部声明在同一个 `auth-http.module.ts`。）

→ **判定：消费方模块 = 1，这不是"缺登记"，是违规。** "≥2 ⇒ 补登记理由" 那条分支**不适用**：
写进头注释的理由会是假的。现有注释 `log.auth.shared.module.ts:9-10` 已写 "Used by decorators and guards
across the application"，而事实是这些 decorator/guard 的宿主模块只有一个。

**上一轮（`reports/batch-5/r1-libs.md:264`）的理由被推翻**：它写"控制器散在多个模块"，据此认为撤 @Global 要改多处。
实测 5 个 controller **全在 `auth-http.module.ts` 一个文件里** ⇒ 改动面 = **1 行 imports + 删 1 行 `@Global`**。

### 1.4 为什么现有 spec 抓不到它（重要）

`apps/server/apps/api/src/common/monorepo/repo-global.drift.spec.ts` 有两个盲区，本例恰好两个都踩：

1. `:29` `const REPO_MODULE_RE = /\.repo\.module\.ts$/` —— 只扫 `*.repo.module.ts`，`*.shared.module.ts` **不在扫描面内**；
2. `:28` `SKIP_DIRS` 含裸名 **`'logs'`** ⇒ `libs/system/src/logs/**` **整棵子树被剪掉**
   （`apps/server/logs/` 是运行期日志目录，实测 201 个文件；意图在此，但裸名匹配把源码目录一起误伤了）。

第 2 点还意味着：即便 `log.auth.repo.module.ts` 是 `*.repo.module.ts`，它今天也**从未被这条 spec 检查过**。
本轮代偿实测（§1.5）：它是合法的，所以补扫描面不会开新红。

### 1.5 顺带查清的两个"隐形"邻居（不在改动范围，但决定 §4 能否扩扫描面）

| 模块 | @Global | 端口绑定 | 消费方模块数 | 判定 |
|---|---|---|---|---|
| `libs/system/src/logs/auth/repo/log.auth.repo.module.ts` | 是 | 否（`:8-14`） | **2**（`log.auth.module.ts`、`log.auth.shared.module.ts`） | 合法，但今天被 `logs` 跳过而看不见 |
| `libs/system/src/logs/operate/repo/log.operate.repo.module.ts` | 是 | **是**（`:19-22` 绑 `WALNUT_ADMIN_OPERATE_LOG_WRITER`） | 1 | 合法（ADR 0022 D3 例外） |

---

## 2. Q2 —— `SysUserOAuthSharedModule` 是否真死，删它会带走什么

### 2.1 死透了：0 注入 / 0 import

`apps/server/libs/identity/src/user_oauth/shared/user_oauth.shared.module.ts:4-9`

```ts
@Module({
  imports: [],                            // :5  空空
  controllers: [],                        // :6
  providers: [SysUserOAuthSharedService], // :7
  exports: [SysUserOAuthSharedService],   // :8
})
```

机械复算：

```
### SysUserOAuthSharedService
  declaring module(s): ["libs/identity/src/user_oauth/shared/user_oauth.shared.module.ts"]
  injecting files (0): []
  consumer MODULES (0): []
```

全仓 `grep SysUserOAuthSharedService` 只有 6 处**自我引用**（`apps/server` 内，无一处是消费）：
`user_oauth.shared.service.ts:9`（定义）· `user_oauth.shared.module.ts:2,7,8`（自己的 import/providers/exports）·
`user_oauth/index.ts:5,6`（barrel re-export）。

**间接引用也查了，全空**：

- 测试：`apps/api/test/**` 零命中（含 `user.identity.oauth.pg.int-spec.ts`、`auth.login-chain.pg.int-spec.ts`）；
- 动态 import / require：symbol grep 会一并命中，0 处；
- `TypeOrmModule.forFeature`：本模块 `imports: []`，没有；
- 端口绑定：providers 无 token；
- 文档：`apps/docs` 内无 `user_oauth.shared` 路径引用。

**孤儿模块扫描**（`@Module` 类从未被任何模块 imports 引用）全仓只有 4 个，其中 3 个是误报/合法：

```
- apps/api/src/app/app.module.ts#AppModule                        ← 组合根，合法
- apps/worker/src/worker.module.ts#WorkerModule                   ← 组合根，合法
- libs/auth/src/modules/shared/welcome/welcome.module.ts#SharedWelcomeModule
                                                                  ← 误报：经 shared.module.ts:8 的
                                                                    [...sharedModules] 展开数组引入
- libs/identity/src/user_oauth/shared/user_oauth.shared.module.ts#SysUserOAuthSharedModule  ← 真死
```

### 2.2 它的 service 是纯透传，删了不丢逻辑

`user_oauth.shared.service.ts:18-20` 的 `bindOAuthForUser` 只是
`return this.sysUserOAuthRepoService.bindOAuthForUser(...)` —— 被委托方
`SysUserOAuthRepositoryService.bindOAuthForUser` 在 `repo/user_oauth.repo.service.ts:47` 是同一份实现
（upsert 语义全在仓库层）。**零独有逻辑、零独有状态、零独有依赖装配。**

### 2.3 删它的连带面：只有一处（barrel）

| 关注点 | 结论 | 证据 |
|---|---|---|
| Entity 注册 | **不受影响** | `TypeOrmModule.forFeature([SysUserOauthEntity], WalnutPGConnectionName)` 在 `user_oauth.module.ts:15`，不在死模块里 |
| 端口绑定 | **没有** | `imports: []` / providers 无 token |
| migration | **不引用模块**，只引用表名 | `apps/api/migrations/1792922206018-InitSchema.ts:482-495`（建表 `sys_user_oauth`）、`:643`（drop） |
| 仓库层 | **必须留** | `SysUserOAuthRepositoryService` 真实消费：`libs/auth/src/modules/oauth/gitee/gitee.service.ts:26`、`github.service.ts:26`、`user_oauth.serivce.ts:13` |
| 仓库模块的 @Global | **删后仍合法** | 消费方模块数 **4 → 3**（gitee / github / SysUserOauthModule / 死模块；删后剩 3，仍 ≥2） |
| 唯一代码改动 | `user_oauth/index.ts:5-6` 两行 re-export | `identity/src/index.ts:27` 再 re-export 该目录 barrel，只动目录 barrel 即可 |
| knip | 不能当证明 | `knip` 当前**有意维持红**（根 `AGENTS.md` 常用命令一节） |

→ **删除 = 删 2 个文件 + 摘 2 行 barrel 导出**；无 entity、无端口、无 migration、无测试连带。

## 3. Q3 —— 装配位置 & 会不会动到 12 条全局 guard 的顺序（最关键）

### 3.1 两个模块今天的装配位置

`SysLogAuthSharedModule`（三跳，全在 libs 内）：

```
apps/api/src/app/app.module.ts:67        SystemModule
  → apps/api/src/modules/system/system.module.ts
  → libs/system/src/system.module.ts:50                  SysLogAuthModule
    → libs/system/src/logs/auth/log.auth.module.ts:21    SysLogAuthSharedModule   ← @Global 在此注册
```

worker 侧同一条链：`apps/api/src/app/core.module.ts:86` 的 `SysSystemModule` → `libs/system/src/system.module.ts:50`。
（`core.module.ts:88-92` 说"漏了安全风控 ⇒ `SysLogAuthSharedService` 第 4 个参数解析失败"，指的是**端口**由
`SecurityRiskModule` 全局绑定，与"本模块自己是否 @Global"无关 —— 撤掉它不影响 worker 启动。）

`SysUserOAuthSharedModule`：**不在任何 imports 里** —— 拥有者 `user_oauth.module.ts:13-17` 只引
`TypeOrmModule.forFeature` + `SysUserOAuthRepositoryModule`。

### 3.2 guard 顺序的真源与实测结构

顺序 = 「模块扫描序 × 模块内 providers 数组序」（`guard-order.drift.spec.ts:8-14`）。用仓库自己的
`module-graph.ts` 复算（`walkModuleGraph('apps/api/src/app/app.module.ts')`），本轮实测：

```
模块节点 24 个；flattened APP_GUARD = 12
index  0  GUARDS[11]  AppModule            ← app.module.ts:89-145（11 条）
index  4  GUARDS[1]   AppTechModule        ← techniques/tech.module.ts（第 12 条 Throttler）
index 12  guardClasses []  AuthHttpModule  ← 本批要加的 import 落点
SysLogAuthSharedModule scan index: -1      ← 根本不在走查结果里
SysUserOAuthSharedModule present in walk: false
```

**为什么 `SysLogAuthSharedModule` 不在走查里**：`module-graph.ts:301-306` 已写明 —— 别名边指向 barrel
（`@walnut-server/auth` → `libs/auth/src/index.ts`，其中无 `@Module`）时 DFS 会断。所以这条 walk
**本身只覆盖 `apps/api/src/**` 的模块节点**，libs 侧一个都没进来。

### 3.3 结论：两笔都动不了 guard 顺序（有前提，见 §5 风险 1）

1. **给 `AuthHttpModule.imports` 加 `SysLogAuthSharedModule`**：该模块的 `guardClasses` 实测为 `[]`
   （只 provide 5 个 passport mixin guard 与 3 个 OTP functional guard，**没有一条 `APP_GUARD`**）。
   `flattenedGuards` 是对节点数组做 flatMap 取 `guardClasses`（`guard-order.drift.spec.ts:44-46`），
   **插入一个 0 守卫节点不改变展开结果**。走查里会多 1 个节点（24 → 25），4 条既有断言
   （`graph.length > 20`、`graph[0] === AppModule`、12 元逐位相等、`rootOnly === 11`）全部不受影响。
2. **删 `SysUserOAuthSharedModule`**：压根不在走查图里（`present in walk: false`），也未被任何模块 imports
   引用 ⇒ 对扫描序零影响。
3. 真实 Nest 侧同理：`APP_GUARD` 只在 `AppModule.providers`（index 0）与 `AppTechModule`（index 4）注册；
   `AuthHttpModule` 在 index 12，把某个无 guard 的模块从 index ~18 提前到 ~13，**注册序里没有任何 guard 参与**。

**前提（会翻车的那种"以为没事"）**：新加的 import 必须落在 `AuthHttpModule`（controller 宿主模块）
**自己的 imports 数组**里。落在父模块 `AuthModule`（`auth.module.ts:16`）上**不算** —— Nest 的 imports
不向下继承，interceptor / guard 注入到宿主 controller 所在模块的注入器里，写错位置只会在**启动期**炸 DI，
编译期与单测全绿。

---

## 4. Q4 —— 改完怎么机械证明（可写进 spec 的断言）

### 4.1 现成门禁（改动后必须仍绿，本轮已取基线）

```powershell
cd apps/server
cmd /c "pnpm exec vitest run --config ./apps/api/vitest.config.ts common/monorepo"  # 基线 8 文件 / 41 tests / exit 0
cmd /c "pnpm types:check"                                                           # 悬空引用 / 类型面
cmd /c "pnpm lint"
cmd /c "pnpm openapi:check:export"  # = openapi:export + git diff --exit-code -- openapi.json（真 bootstrap AppModule）
```

`openapi:check:export`（`apps/server/package.json:41`）是**唯一真 bootstrap** 的门禁：把 AppModule 整个容器拉起来，
**DI 图解析不了就起不来**。这是"撤 @Global 没破坏 DI"最硬的证据，且顺带钉住 openapi 路径顺序（因而钉住 controller 注册序）。
`guard-order.drift.spec.ts` 4 条 + `core-module-scope.drift.spec.ts` 7 条已覆盖顺序与 worker 作用域。

### 4.2 现在**不够**的五条，建议补进 spec（否则"绿"是演给自己看的）

| # | 断言 | 落点 | 为什么必须补 |
|---|---|---|---|
| **A1** | `*.shared.module.ts` 也纳入 @Global 判据：`isGlobal && !hasTokenBinding` ⇒ 消费方模块数 ≥ 2 | 扩 `repo-global.drift.spec.ts:29` 的扫描面（或新建 `shared-global.drift.spec.ts`） | 今天 `REPO_MODULE_RE` 只认 `*.repo.module.ts`，本笔债**结构性逃逸** |
| **A2** | 消费方计数必须含 `controllers[]` 与**属性级 `@Inject`** | 改 `repo-global.drift.spec.ts:164-166`（`classOwnerModules` 现在只从 `providerClasses` 建） | 按今天口径复算，`AuthOpaqueUserController` 的宿主模块被**统计为 0**（controller 在 `controllers:` 而非 `providers:`）——不补这条，A1 上线即假绿 |
| **A3** | 非 @Global 模块的每个消费方都能经 imports 闭包看见它（复用 `:265-290` 的 `exportedClassProviders`） | 同上 | 判据 ② 今天同样只覆盖 repo 模块；撤 @Global 后"忘了加 import"只能靠启动期发现 |
| **A4** | 孤儿模块守卫：每个 `@Module` 类要么被别的模块 imports 引用，要么是组合根白名单 | 新建 spec（或并入 `lib-registration.drift.spec.ts`） | 这正是 `SysUserOAuthSharedModule` 该被抓住的形态；白名单 = AppModule / WorkerModule，**必须展开数组感知**（否则 `SharedWelcomeModule` 假红，见 §2.1） |
| **A5** | 修 `SKIP_DIRS` 的 `'logs'`：只跳根级 `apps/server/logs`，不跳 `libs/*/src/logs` | `repo-global.drift.spec.ts:28` | 否则 `libs/system/src/logs/**` 永远不进任何源码扫描守卫。**已代偿验证不会开新红**（§1.5：一个合法、一个有端口例外） |

A3 的断言形状（可直接抄）：

```ts
// 撤 @Global 之后：AuthHttpModule 必须能经自己的 imports 闭包看见 SysLogAuthSharedService
const visible = new Set<string>()
for (const imported of infos.get(authHttpModuleFile)!.importedIds) {
  const child = moduleByClass.get(imported)
  if (child) for (const p of exportedClassProviders(child)) visible.add(p)
}
expect(visible.has('SysLogAuthSharedService')).toBe(true)
```

### 4.3 一条负向控制（防"spec 变绿是因为它没跑"）

`repo-global.drift.spec.ts:251-255` 已有"扫描口径有效"自检（`reports.length >= 10` 且 global / 非 global 都有）。
新增 A1 时同理加一条：**扫描面必须包含 `log.auth.shared.module.ts`**

```ts
expect(reports.some(r => r.file.endsWith('log.auth.shared.module.ts'))).toBe(true)
```

否则 `logs` 那类剪枝会让新守卫静默空转。

---

## 5. Q5 —— 最可能翻车的三点

1. **import 加错模块层级（最可能）**：`SysLogAuthSharedModule` 必须加到 `auth-http.module.ts:50-63` 的 `imports`，
   不是父级 `auth.module.ts:16`。Nest 的 imports 不向下继承，而 interceptor / guard 注入到**宿主 controller 所在
   模块**的注入器；写错时**编译期、lint、单测全绿**，只在 `nest start` / `openapi:export` 时炸
   `Nest can't resolve dependencies of WalnutAdminInterceptorRequestAuthLog`。
   → 缓解：把 `openapi:check:export` 作为必跑门禁（它真 bootstrap）。

2. **@Global 一直在掩盖"未来第 2 个消费方"，撤掉后是静默定时炸弹**：`WalnutAdminGuardAuth` 是 mixin 工厂
   （`libs/guards/src/guards/auth.guard.ts:19`），任何新 controller 写 `@UseGuards(WALNUT_ADMIN_GUARD_AUTH(...))`
   或 `@WalnutAdminDecoratorAuthLog(...)`，都会被自动插成**那个模块**的 injectable。今天全落在 `AuthHttpModule`，
   但**没有任何编译期或单测级约束**阻止有人把它用到 system / identity 的 controller 上 —— 那时错误只在启动期出现。
   → 缓解：A3 那条 spec 是必需的，不是锦上添花。

3. **"绿"的可信度本身**：本债由 `repo-global.drift.spec.ts` "按新判据扫出来"的说法**不成立** —— 该 spec 两个盲区
   （`*.repo.module.ts` 后缀 + 裸名 `logs` 剪枝）都会让它扫不到本模块（§1.4）。改完若只跑现有 spec 报绿，
   证明的是"这条债不在门的视野里"，不是"债没了"。→ 缓解：A1 / A2 + §4.3 负向控制必须同批落地，否则验收退化成人工 grep。

（次要，**不要动**：`providers: [..., Reflector]`（`log.auth.shared.module.ts:15`）是冗余的 —— `Reflector` 由 Nest
内部核心模块全局提供。它不影响判据，但撤 @Global 后别顺手删：删了若判断有误就是启动期 DI 红，收益为零。）

---

## 6. 该做什么 / 不该做什么

### 该做

1. **Q1（违规，撤 @Global）**：删 `log.auth.shared.module.ts:12` 的 `@Global()`；在 `auth-http.module.ts` 的
   `imports`（`:50-63`）末尾加 `SysLogAuthSharedModule`；更新模块头注释（现有 "Used by decorators and guards
   across the application" 已过期，真实消费方是 `AuthHttpModule` 一个）。
2. **Q1 的模块头注释写明判据与计数**：写明"消费方模块 = 1（AuthHttpModule），故不 @Global" —— 让下一个人不必重跑扫描。
3. **Q2（死模块，删）**：删 `user_oauth/shared/user_oauth.shared.module.ts` 与
   `user_oauth/shared/user_oauth.shared.service.ts`；删 `user_oauth/index.ts:5-6` 两行 re-export。
   `repo/user_oauth.repo.module.ts`、`user_oauth.module.ts`、entity、migration **一律不动**。
4. **同批补 §4.2 的 A1 / A2 / A3 / A4 / A5**（否则本批无法机械验收）。
5. 验收按 §4.1 四条命令跑；按 `apps/server/AGENTS.md`「测试」节：**integration 串行**（globalSetup 有 PG advisory
   lock，抢不到会等 2 分钟）。相关集成用例 = `log.bypass.pg.int-spec.ts`（`:138-140` 用
   `app.get(SysLogAuthSharedService)` 走全容器查找、**不依赖 @Global**，撤掉后不会红）、`user.identity.oauth.pg.int-spec.ts`。

### 不该做

1. **不要**给 `SysLogAuthSharedModule` 补一条"消费方 ≥2"的头注释来消警 —— 计数是 1，注释会是假的。
2. **不要**把 import 写到 `auth.module.ts` / `system.module.ts`（层级错 = 启动期炸）。
3. **不要**顺手撤 `log.auth.repo.module.ts` / `log.operate.repo.module.ts` 的 `@Global`：前者消费方 = 2、
   后者有端口绑定，两者都**合法**；动它们纯属扩大爆炸半径。
4. **不要**删 `SysUserOAuthRepositoryModule` / `SysUserOAuthRepositoryService`（gitee / github / user_oauth 三处真实消费）。
5. **不要**改 `app.module.ts` 的 `APP_GUARD` 数组、`tech.module.ts` 的 Throttler 注册、或
   `guard-order.drift.spec.ts:26-39` 的黄金表 —— 本批不需要；动了就必须同步两边（AGENTS.md 明写）。
6. **不要**用 `knip` 的绿作为验收（当前有意为红）；也不要把"现有 spec 全绿"当成"债已消"。

---

## 7. 待 Lead 拍板

1. **两笔是否同批**：Q2 是纯删除（零风险）；Q1 动认证链路 1 个模块的 imports。建议同批，但两者**互不依赖**，
   若怕与其它认证改动撞车可拆两批。
2. **改哪一边：spec 还是文档**：AGENTS.md 表格说 Shared Service 一律不 @Global（除端口绑定），但机械守卫只覆盖
   Repository。是「补 spec 到与文档一致」（我推荐，§4.2 A1）还是「把文档降级成与 spec 一致」（承认 Shared Service
   的 @Global 不设门）？选后者则本笔债永无机守。
3. **A5（`logs` 剪枝）要不要在本批一起修**：它会让 `libs/system/src/logs/**` 第一次进入源码扫描面。已代偿验证
   不开新红（§1.5），但把本批改动面扩大到一条共享 spec —— 需要你确认。
4. **A4（孤儿模块守卫）是否单独立项**：它抓的正是"死模块"这一类，覆盖面比本批两笔更大（目前只发现 1 个真孤儿）。
5. **`Reflector` 冗余 provider 是否顺手清**（`log.auth.shared.module.ts:15`）：我建议**不清**（收益 0、风险是启动期
   DI），但它是代码风格口径上的小瑕疵，登记与否请你定。

---

## 附录 A —— 复跑口径（只读，脚本落在 TEMP 目录，不碰仓库）

消费方模块计数（判据的"消费方模块数"要算准，必须含 `controllers[]` 与属性级 `@Inject`）：

- 坑 1：`SKIP_DIRS` **不要放裸名 `'logs'`**，否则 `libs/system/src/logs` 整棵子树消失；
- 坑 2：`classOwnerModules` 要**同时**从 `providers[]` 与 `controllers[]` 建，只建 providers 会把 controller 宿主算成 0；
- 坑 3：`@Inject` 要连**属性级**一起扫（mixin guard 的写法），只扫构造器参数会漏掉 `auth.guard.ts`。

## 附录 B —— 本轮四组实测输出（原样）

```
### SysLogAuthSharedService        consumer MODULES (1): auth-http.module.ts
### SysUserOAuthSharedService      consumer MODULES (0)
### SysLogAuthRepoService          consumer MODULES (2)
### SysUserOAuthRepositoryService  consumer MODULES (4) → 删死模块后 (3)
```

guard 顺序复算（直接用仓库自己的走查器，Node 24 原生跑 .ts）：

```powershell
cd apps/server
node -e "import('file:///D:/walnut-admin/walnut-admin/apps/server/apps/api/src/common/monorepo/module-graph.ts')"
# 实测：24 节点 / 12 条 APP_GUARD / AppModule=11 / AppTechModule=1 /
#       AuthHttpModule.guardClasses=[] / SysLogAuthSharedModule 不在图里
```


