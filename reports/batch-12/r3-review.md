# 批次 12 · D 组结构债 · R3 复查轮

> **我是全新的复查 Agent，R1/R2 都不是我做的。所有读数都是我自己重跑的**，不引用他们的输出；
> 与 R2 的“一致/不一致”是对他们结论的判定，不是我的证据。
> 只读轮：**没有改任何源码**（临时探针与负对照脚手架全部在 %TEMP% 或运行后删除，见 §7）。
> HEAD `bf3c1c1d`，工作树不 clean（R2 未提交）：11 个改动文件 + `reports/batch-12/`。

## 0. 结论先行

| 项 | 判定 |
|---|---|
| ① 撤 @Global 的落点 | **正确且是承重的**（落在 `auth-http.module.ts`；落父模块 / 不落都真 bootstrap 失败） |
| ② guard 顺序零变化 | **成立**（真实容器 `getGlobalGuards()` 12 元逐位等于黄金表）；但 R2 的“**模块扫描序零变化**”**不成立**（§2.2） |
| ③ 死模块删除 | **干净**（代码 0 残留；`SysUserOAuthRepositoryModule/Service` 仍在且运行时仍被消费） |
| ④ 新判据有牙 | **有**（A1 / A2×3 / A1b / A3 六个负对照全红；四个“假绿坑”的修法逐个验证，**没有把判据改松**） |
| ⑤ A5 `SKIP_DIRS` | **成立**（只跳 `apps/server/logs`；`libs/system/src/logs/**` 28 个源文件进视野；未开新红） |
| ⑥ 4 个只加注释 | **成立**（+12 行、0 删除、非注释行 0、`@Global()` 计数不变） |
| 补跑 | 单测 101/836 绿；集成分片 12 文件 / 176 条绿（53 片未跑）；types:check / lint / boundaries / openapi:export 全绿（真跑，非缓存） |
| **最终** | **可提交（附 2 个条件，见 §8）** —— 代码面没挑出缺陷，挑出的是**报告与工作树不一致** |

---

## 1. 我的口径与三个“差点翻车”的坑（先说清楚，否则后面的读数不可信）

本机有一台 **`nest start api --watch` 的 dev server 在跑**（PID 49492，父 turbo 3876 / cross-env 5420），
它会**持续重写 `apps/server/dist`**。这毁掉了我第一版“before/after 编译产物对比”，三个坑按顺序：

1. **坑 A（编码）**：PowerShell 里 `git show HEAD:path > file` 写出来的是 **UTF-16**，SWC 报
   `Failed to convert bytes to UTF-8` / `Failed to compile: apps/api/src/modules/auth/auth-http.module.ts`，
   `nest build` 退出码 1 —— 但 `deleteOutDir` 在 `cli` 项目里是 `false`，**dist 里的旧产物不会被清掉**，
   于是我的“BEFORE”探测实际跑的是“AFTER”的编译产物，两份输出当然完全一致。**该轮数据作废。**
2. **坑 B（watcher）**：改用 `git checkout HEAD --` 后编译是对的，但**守护进程会在 1 秒内把 dist 重写回工作树版本**，
   probe 时读到的又是 AFTER。**该轮数据作废。**
3. **坑 C（我自己污染了集成测试）**：我在集成 shard 1 运行期间换了源文件，导致 4 个 int-spec 套件
   setup 阶段全灭（71 条 skip）。**不是本批缺陷**；干净重跑后 4 文件 / 71 条全绿（§5）。

**最终采用的可靠口径**：拿 `nest --watch` 当编译服务 —— 改文件 → 轮询编译产物内容确认已生效 → 探测 → 还原 → 再轮询。
所有“BEFORE”都是**把两个文件同时还原到 HEAD**（这样 `@Global` 还在、应用起得来，才测得到扫描序），
不是“只还原一个”的半截状态。每次还原都用 SHA256 校验，`git status` 逐轮核对。

---

## 2. 逐项复查

### 2.1 ① `SysLogAuthSharedModule` 撤 @Global 的落点 —— 正确，且是承重的

**文件级证据**

| 位置 | 内容 |
|---|---|
| `apps/api/src/modules/auth/auth-http.module.ts:16` | `import { SysLogAuthSharedModule } from '@walnut-server/system'` |
| `…auth-http.module.ts:64-67` | 在 `imports:` 数组末尾追加（带 3 行注释解释落点） |
| `apps/api/src/modules/auth/auth.module.ts:15-17` | **没有**它：`imports: [SysAuthModule, AuthHttpModule]`，全文件 18 行无该标识符 |
| `libs/system/src/logs/auth/shared/log.auth.shared.module.ts` | `@Global()` 已删（连 `Global` 的 import），改头注释登记判据 + 计数 |

（补充：`libs/system/src/logs/auth/log.auth.module.ts:11,21` 也 import 它 —— 那是**拥有者侧**的 import，不是消费方，
不影响“消费方模块 = 1”。）

**真 bootstrap 三态实验（每种都是真的 `NestFactory.create(AppModule)` + `app.init()`，连真 PG/Redis）**

| 实验 | 接线 | 结果 |
|---|---|---|
| **S1 正确落点** | `auth-http.module.ts` import | **起得来**：194 个模块 / 12 条全局 guard |
| **S2 不接线** | HEAD 版 `auth-http`（无 import）、`@Global` 已撤 | **起不来**：`Nest can't resolve dependencies of the AuthGoogleGuard. Please make sure that the "logAuthSharedService" property is available in the current context. … Is AuthHttpModule a valid NestJS module?` |
| **S3 落父模块** | import 放到 `auth.module.ts`（`imports: [SysAuthModule, AuthHttpModule, SysLogAuthSharedModule]`） | **起不来**：与 S2 **逐字相同**的报错 |

S3 是本轮最关键的一条：R1 只是预测“落父模块会炸”，我把它**跑出来了** —— Nest 自己的报错文案甚至点明
`…is that module imported within AuthHttpModule?`，即注入器确实解析在**宿主 controller 所在模块**。

**意外拿到的第四条证据（运行时承重）**：§1 坑 C 里我误把源文件换成 HEAD 版，集成测试立刻有
**4 个套件 / 71 条在 setup 阶段全灭**，报错同样是 `logAuthSharedService` 不可解析 ⇒ 这条 import 不只
openapi bootstrap 需要，**测试侧的部分模块装配也需要**（`Test.createTestingModule` 的 partial module）。
以后谁拆/挪这个接线，爆炸半径 = “openapi:export + 4 个集成套件”。

### 2.2 ② guard 顺序 —— 成立；但 R2 的“模块扫描序没变”是错的

**真实容器读数（不是走查器）**：`container.applicationConfig.getGlobalGuards()` 拿到的是**已实例化**的 guard，
按注册序：

```
WalnutAdminGuardIP > WalnutAdminGuardSecurity > WalnutAdminGuardDevice > WalnutAdminGuardRisk
> WalnutAdminGuardCap > JwtAccessGuard > WalnutAdminGuardRisk > WalnutAdminGuardCap
> WalnutAdminGuardMFA > WalnutAdminGuardSign > WalnutAdminGuardLock > WalnutAdminGuardThrottler
```

逐位等于 `apps/server/AGENTS.md` 的“Security Guard 执行顺序”与 `guard-order.drift.spec.ts` 的 12 元黄金表。

**HEAD（BEFORE，两文件都还原）vs 工作树（AFTER），同一套探测方法**：

| 指标 | BEFORE（HEAD） | AFTER（工作树） |
|---|---|---|
| 模块数 | **194** | **194**（集合完全相同：only-in-before=0 / only-in-after=0） |
| 全局 guard 数 | 12 | 12 |
| guard 序列 | 见上 | **逐字节相同** |
| `AppModule` / `AppTechModule`（两个 APP_GUARD 宿主）扫描位 | 1 / 16 | **1 / 16**（不变） |
| `AuthModule` / `AuthHttpModule` 扫描位 | 69 / 97 | 69 / 97（不变） |
| `SysLogAuthSharedModule` 扫描位 | **156** | **98** |
| 扫描序列里位置不同的下标 | — | **48 个**（98 起整体后移 2） |

⇒ **guard 顺序零变化：成立**（12 元逐位相等；两个注册点文件在 `git status` 里根本没有：`app.module.ts` /
`tech.module.ts` / `guard-order.drift.spec.ts` 全部未被改动；`APP_GUARD` 出现次数 HEAD 与工作树一致：
app.module 12 / tech.module 3）。

⇒ **“模块扫描序没变”不成立**：真实容器 194 个模块（R2 的“24 节点”是走查器的**局部**视图）。本批把
`SysLogAuthSharedModule` 从扫描位 156 提前到 98（它现在也挂在 `AuthHttpModule` 的 imports 边上，而后者在 97），
其后 48 个位置整体后移 2。**模块集合没变、guard 宿主位置没变**，所以 flatten 出来的 guard 序列不变 ——
结论对，但**证据陈述错**：R2 §4 用“两份走查输出完全相同”（而 `sysLogAuthSharedInWalk: false`，该模块压根不在他们图上）
当“扫描序不变”的证据，是拿盲区当结论。

**为什么这不影响本批**：摊平是 `flatMap(node => node.guardClasses)`，本批移动的节点 `guardClasses = []`
（只 provide `SysLogAuthSharedService` + `Reflector`），且两个 APP_GUARD 宿主位置不变 ⇒ 展开结果逐位不变。
最硬的旁证：真 bootstrap 的 12 元序列 + `guard-order.drift.spec.ts` 4 条全绿 + `openapi.json` 零 diff
（路径序顺带钉住 controller 注册序）。

### 2.3 ③ 死模块删除 —— 0 残留，且删的是“死”、留的是“活”

```
$ git grep -n "SysUserOAuthShared"
apps/docs/…/10-implementation-plan.md:405   ← 历史文档
reports/batch-5/r1-libs.md:265              ← 旧报告
# 代码里 0 处（含测试 / barrel / 动态 import / 字符串）

$ git grep -n "user_oauth.shared"           → 无匹配（exit 1）
$ ls apps/server/libs/identity/src/user_oauth
dto  entity  repo  index.ts  user_oauth.basic.repository.ts  user_oauth.module.ts  user_oauth.serivce.ts
# shared/ 已不存在；repo/user_oauth.repo.module.ts、repo/user_oauth.repo.service.ts 仍在

$ git grep -n "SysUserOAuthRepositoryService"
libs/auth/src/modules/oauth/gitee/gitee.service.ts:26          ← 真实消费
libs/auth/src/modules/oauth/github/github.service.ts:26        ← 真实消费
libs/identity/src/user_oauth/user_oauth.serivce.ts:13          ← 真实消费
apps/api/test/integration/auth.login-chain.pg.int-spec.ts:264  ← app.get(...)
apps/api/test/integration/user.identity.oauth.pg.int-spec.ts:95 ← app.get(...)
```

**运行时反证（比 grep 强）**：`auth.login-chain` 与 `user.identity.oauth` 都在 `beforeAll` 里
`app.get(SysUserOAuthRepositoryService)`，我把它们**跑绿了**（§5）⇒ 该仓库服务不仅文件在，容器里仍解析得到、功能仍可用。
barrel 摘掉 2 行后 `tsc --noEmit` exit 0 ⇒ 无悬空 re-export。

### 2.4 ④ 新判据真的有牙 —— 6 个负对照 + 4 个“假绿坑”逐条确认

脚手架建在 `apps/server/libs/__r3neg__/`（spec 扫整棵 `apps/server`，放 %TEMP% 扫不到），**跑完整目录删除**，
`Test-Path` = False，`git status` 无残留。

| # | 造什么违规 | 期望 | 实测（原样摘要） |
|---|---|---|---|
| **N1 = A1** | `*.shared.module.ts` 且 `@Global()`、0 消费方、注释不提 @Global | ① 红 | ✅ `libs/__r3neg__/a1/r3neg-a1.shared.module.ts（消费方 0：无）` |
| **N2 = A2/controllers** | 服务只被 `controllers: []` 里的 controller 构造注入，宿主模块不 import | ② 红 | ✅ `…r3neg-a2.module.ts 注入了 …[R3NegA2Service]，但 imports 闭包里看不见它` |
| **N3 = A2/属性级** | 服务只被属性级 `@Inject()` 注入（mixin 写法），模块不 import | ② 红 | ✅ 同上形态（a3p） |
| **N4 = A2/增强器宿主** | `providers: [{ provide: APP_GUARD, useClass: G }]`，G 构造注入，模块不 import | ② 红 | ✅ 同上形态（a4g） |
| **N5 = A1b** | `@Global()` + 2 个消费方（都 import 了它）+ 注释不写 @Global | ①b 红 | ✅ `…（消费方 2）没在模块注释里登记 @Global 理由` |
| **N6 = A3** | 删掉 `auth-http.module.ts` 里那行 import | ② 红 + 回归 红 | ✅ 两条都红 |
| **S2（bootstrap 级）** | 不接线 | 启动期炸 | ✅ §2.1（比 spec 更狠：编译/单测全绿，只有启动炸） |

**四个“会假绿”的坑，逐个确认“修法正确”而不是“改松”**：

| 坑 | 修法 | 我的验证 | 结论 |
|---|---|---|---|
| **Reflector 假红** | `providerClasses` 过滤掉“非本仓声明”的类 | （a）造 `providers: [Svc, Reflector]`、只 export Svc + 消费方 → **不红**（假红被修掉）；（b）造“本仓声明的 provider 不 export” → **红**（`R3NegA8Hidden`） | 修法对，**不是宽放**：只吃框架/外部类，本仓类照抓 |
| **`...sharedModules` 展开** | `readLocalArrayConsts` + 展开 imports/exports | 造 wrapper（`const mods = [M]`）：· imports/exports 都展开 → 消费方**不红**（真可见）；· 只展开 imports、exports 不带 → 消费方**红** | 展开确实在承担可见性判定，**不是“看不见就放过”** |
| **同名 provider 双份** | 消费方自己 provide 同名类 ⇒ 不算别人的消费方 | 造“scoped 模块提供 Svc，消费方模块自己 provide 同名 Svc 再注入” → **不红** | 符合 Nest 语义（用它自己那份）；N2/N3/N4 证明“不 provide 就会红”，skip 没吃掉真消费方 |
| **`{provide: APP_GUARD, useClass}` 宿主** | `readArrayProperty` 从对象字面量取 `useClass` | 就是 **N4** | ✅ 有牙 |

**判据本身的边界（不是缺陷，但要知道）**：
1. **①b 是文字门禁**：注释里出现 `@Global` 字样即通过 —— 本批 4 个文件正是这么过的；拦不住“写了但理由错”。
2. **`hasTokenBinding` 判定偏宽**：`providers` 里出现任何**非 identifier** 元素就算“端口绑定”。
   A2 之后 `providerClasses` 会从 `{provide: APP_GUARD, useClass: X}` 取 X，但**同一处**也把该模块标成
   `hasTokenBinding = true` ⇒ 若将来某个 `*.repo/shared.module.ts` 注册任意增强器，会被 ①/①b **豁免**。
   当前 31 个在扫描面的模块里无此实例，属**建议收紧**（只认 `WALNUT_ADMIN_*` token），不影响本批。
3. 判据 ② 按**类名**跨文件建映射（同名类会串味）；`moduleByClass` 每文件只取第一个 `*Module` 类。既有口径。

### 2.5 ⑤ A5：`SKIP_DIRS` 的裸名 `'logs'` —— 修对了，且没开新红

```
SKIP_DIR_NAMES = { node_modules, dist, .git, coverage, env-local, env-encrypted, public }   ← 无 'logs'
SKIP_ABSOLUTE_PATHS = { join(process.cwd(), 'logs') }  ==  apps/server/logs               ← 只剪运行期目录
```

| 事实 | 读数 |
|---|---|
| `apps/server/logs` | 203 个文件，其中 **.ts 0 个**、scoped module **0 个** ⇒ 剪它纯属语义/性能，不影响扫描结果 |
| `libs/system/src/logs/**` | 28 个 .ts，**首次**进入扫描面 |
| 该子树里的 2 个 scoped 模块 | spec 首条断言显式要求 `log.auth.shared.module.ts` 与 `log.auth.repo.module.ts` **必须在报告里**（证明没被剪），且都绿 |
| 全套 drift spec | **8 文件 / 44 条 / exit 0**（未开新红；`log.operate.repo.module.ts` 有端口绑定，走例外分支，合法） |

### 2.6 ⑥ 4 个既有模块“只加注释” —— 成立

```
$ git diff -U0 -- <4 files>
added=12  removed=0  non-comment added lines=0      ← 每文件 +3 行，全部是 " + * …" 注释
$ git grep -c "@Global()" HEAD -- <4 files>   → 每个 1
$ git grep -c "@Global()"      -- <4 files>   → 每个 1     （装饰器没动）
```

`@Module({...})` 的 imports/providers/controllers、类名、导出全部未变 ⇒ **零行为改动**。
（注释里“消费方跨 X/Y 多域”这类措辞**没有**机械校验 —— ①b 只要求出现 `@Global` 字样；这是文字门禁的已知上限。）

---

## 3. 与 R2 报告不一致的地方（我挑出来的错）

| # | R2 的说法 | 我实测 | 严重度 |
|---|---|---|---|
| **1** | §1 改动清单 **10 个文件**；§5.4 说 `cap.shutdown-order.spec.ts` 的 types:check 红“**未修**”，并把“要不要我顺手修”留给 Lead | 工作树是 **11 个文件**，`git diff` 里 **`libs/security/src/cap/cap.shutdown-order.spec.ts` 已被改**，内容正是 R2 自己建议的 2 行：`mockImplementation(async () => {…})`（去掉第 2 参）+ `}, 30_000)` 移到 `it(...)` 第三参。**这是未申报的改动**，而且**不是纯注释**：该用例超时从默认 5s 变成 30s（测试严格度实质下降） | **高（流程）** |
| **2** | §1 diffstat `339 insertions(+), 112 deletions(-)` | 实际 `11 files changed, 351 insertions(+), 114 deletions(-)` —— 复现不出来 | 低（数字过期） |
| **3** | §5.4“types:check 红 1 条 —— 本轮之前就存在…不修则全仓永远红” | **当前树不红**：我真跑 apps/server 的 `tsc --noEmit` **exit 0**；全仓 `pnpm types:check` 也 exit 0（turbo 缓存里能命中一个“该输入集成功”的 server types:check 记录 —— 说明这条修法早就跑绿过，报告只是没更新） | 中（结论过期） |
| **4** | §4“**模块扫描序零变化**”，证据是“两份走查输出完全相同”，同时自述 `sysLogAuthSharedInWalk: false` | **不成立**：真实容器 194 模块，`SysLogAuthSharedModule` 扫描位 **156 → 98**，其后 **48 个位置**整体后移 2。guard 序列确实逐位不变（结论对），但“扫描序不变”是**拿盲区当证据** | **中（证据错，结论对）** |
| 5 | §5.1 单测 101/836、drift 8/44、§5.2 openapi 202 schemas + 零 diff、§5.3 lint/boundaries 绿、§2.2 死模块 0 残留 | **我全部复现一致** | — |
| 6 | §3 的 3 条负对照 | 我重做 6 条（+4 个假绿坑确认），结论一致；更强的是 §2.1 的 S2/S3 bootstrap 对照 | — |

---

## 4. 补跑：单测

```
$ cd apps/server && cmd /c "pnpm test > log 2>&1"       # 真重定向，拿真 exit code
 Test Files  101 passed (101)
      Tests  836 passed (836)
   Duration  74.60s
exit 0
```

（提醒后来者：第一次我用 `cmd /c "pnpm …" 2>&1 | Tee-Object …` 这种管道跑，**job 退出码是 1** ——
那是 PowerShell 把原生命令 stderr 转成 error record 的产物，vitest 自己全绿。**别拿管道后的退出码当门禁读数**：
要么 `> file 2>&1`，要么立刻取 `$LASTEXITCODE`。）

## 5. 补跑：集成分片（auth 相关，串行、无并发）

**并发前置检查**：进程表里除那台 `nest --watch` dev server 外**没有** vitest/integration 进程；
globalSetup 打印 `[integration globalSetup] 已拿到排他锁（key=730942001，等待 0s）` ⇒ 确实没抢锁。

| 片 | 内容 | 结果 |
|---|---|---|
| **Shard 1（int-spec）** | `auth.login-chain` · `auth.refresh-token` · `user.identity.oauth` · `log.bypass` | **4 文件 / 71 条 / exit 0**（59.83s） |
| **Shard 2（api-spec）** | `auth-session` · `guard-matrix` · `permission-chain` · `user-me` · `log-auth` · `external-oauth` · `otp` · `opaque-admin` | **8 文件 / 105 条 / exit 0** |
| **分片合计** | 12 文件 | **176 条全绿，0 失败** |

**未跑片（53 个）**：`int/` 15 个（app.key · app.setting · area.tree · data-scope.rls · deleted.recycle ·
device.purge · device.user-device.monitor · lang.locale.i18n · menu.role · pg.base-repository · pg.purge ·
pg.transaction · user-preference.upsert · user.lock · user.mfa），`api/` 38 个（含 user / role / menu / dict /
device / security / data-scope 三个 / throttle / cap-throttle / logger / monitor / setting 等）。
**选片理由**：本轮只动 auth 模块接线（`AuthHttpModule`）+ auth 日志共享模块，所以挑了“会走到 AuthHttpModule 的
guard/interceptor 链”的 int-spec + 鉴权/权限/会话/日志的 api-spec。**未跑片不代表通过。**

## 6. 补跑：四道门禁（都是我真跑的，不是 turbo 缓存重放）

```
$ cd apps/server && cmd /c "pnpm exec tsc --noEmit --pretty"     exit 0      # types:check
$ cd apps/server && cmd /c "pnpm lint"                            exit 0      # 3 problems (0 errors, 3 warnings)
                                                                             #   ← pg-list.builder.spec.ts 既有 ts/no-unsafe-assignment
$ cd D:\walnut-admin\walnut-admin && cmd /c "pnpm boundaries"    exit 0      # Checked 4688 files in 15 packages, no issues
$ cd apps/server && cmd /c "pnpm --filter @walnut/server openapi:export" exit 0
      Successfully compiled: 870 files with swc
      [NestApplication] Nest application successfully started
      [export-openapi] written …\apps\server\openapi.json (openapi 3.0.0, 202 schemas)
$ git diff --exit-code --quiet -- apps/server/openapi.json        exit 0      # 零 diff
```

（全仓 `pnpm types:check` / `pnpm lint` 我也跑了，都 exit 0，但命中 `FULL TURBO` 缓存重放 —— 缓存不算我的读数，
所以另跑了上面两条**不带 turbo** 的真跑；`boundaries` 是直接执行的。）

## 7. 脚手架清理

| 位置 | 内容 | 状态 |
|---|---|---|
| `apps/server/libs/__r3neg__/` | 6 组负对照（A1 / A2×3 / A1b / 同名双份 / 展开 / Reflector） | **已整目录删除**，`Test-Path` = False |
| `%TEMP%\r3probe\` | 探测脚本、before/after JSON、被换文件的备份 | 已删除 |
| 工作树 | 11 个改动文件 + `reports/batch-12/`（与开始时**逐字一致**：每次换文件都 SHA256 校验 + `git status` 核对） | ✅ |

---

## 8. 这次收尾有没有让别的门禁/约定失效？

**结论：没有让任何门禁失效，但让一条“测试严格度”约定悄悄变松，且没有申报。**

- **变强的地方**：`apps/server/AGENTS.md` 里两条原本只有文字的规定现在有机守 ——
  “@Global 只在消费方模块 ≥2 时允许（并登记理由）”（①/①b）与“非 @Global 的每个消费方都要能经 imports 看见它”（②）。
  A1/A2/A5 补齐后，`libs/**/src/logs/**` 这类子树不再结构性逃逸。
- **没有失效的门禁**（全部真跑）：单测 101/836 · drift 8/44 · types:check · lint · boundaries · openapi:export + 零 diff · 集成分片 176 条。
- **变松的那一条（需要你拍板）**：`cap.shutdown-order.spec.ts` 超时 5s → 30s（§3 第 1 条）。不是门禁失效，
  而是“一个本来在负载下会红的用例现在不会红了”，且它**不在 R2 的改动清单里**、R2 正文还写着“未修”。
  **修法本身是对的**（`it(name, fn, timeout)` 才是超时的正确位置），但它必须被看见。
- **遗留观察（不影响本批）**：①b 是文字门禁；`hasTokenBinding` 口径偏宽（增强器算端口绑定）；
  走查器 `module-graph.ts` 对 libs 侧的盲区仍在（本批实测真实容器 194 模块 vs 走查 24/25 节点）。

### 明确结论

> **可提交，附 2 个条件**：
> 1. 把 `libs/security/src/cap/cap.shutdown-order.spec.ts` 的 2 行改动**补进改动清单**，写明“测试超时 5s → 30s”，
>    由 Lead 明确背书；若不接受，回退这 2 行 —— **代价是 types:check 会重新红 1 条**（`TS2554`，批 7 遗留）。
> 2. 更正 R2 报告两处陈述：§4“模块扫描序零变化”→“**模块集合不变、guard 序列不变，但该无 guard 节点扫描位 156→98**”；
>    §5.4“types:check 永久红”→ 当前树**已绿**（因为那 2 行其实改了）。

**代码面我没有挑出缺陷**：落点正确且承重（三态 bootstrap 实证）、guard 序列逐位不变、死模块 0 残留、
新判据 6 个负对照全红且四个“假绿坑”的修法经得起反向检验、A5 未开新红、4 个注释文件零行为改动、
6 道门禁 + 176 条集成分片全绿。剩下的都是**报告诚实性**问题，不是代码问题。
