# 批次 8 · 守卫链安全三件（B2 / B3 / B6）

> 实施 agent 交付报告。全部改动**未提交**（按指示不 git commit）。
> 三件独立可验证，按 B2 → B3 → B6 顺序落地；每条都有「改回旧行为必须红」的负对照。

## 0. 先说环境（这条影响所有读数，请先读）

开工时工作树**不 clean**：**批次 9 的 agent 在同一个 worktree 里并行作业**（同一 `D:\walnut-admin\walnut-admin`）。
证据（非我的改动）：

- `apps/server/libs/decorators/src/field/number.decorator.ts`、`validator/base/number.validator.ts`（15:04 被改）；
- `apps/admin/src/utils/table/list-filters.ts`、`libs/list`、`libs/repository/pg-list.builder*`、
  `apps/server/openapi.json`、`packages/generated/api-types/src/schema.d.ts`、`apps/docs/**`、`knip.config.ts`；
- `reports/batch-9/logs/` 有 15:04–15:11 的日志；PID 17668 当时正在跑 `vitest --config vitest.config.integration.ts`。

处理方式与影响：

1. **不抢跑**：`test` / `test:integration` 只在确认「本仓无其它 vitest 进程」时启动（我用 `Get-CimInstance` 查过进程表），
   两条读数都是独占跑的；`test:integration` 另外由 globalSetup 的 PG advisory lock 兜底（实测打印「已拿到排他锁，等待 0s」）。
2. **types:check 一度红在两个 number 文件**（批次 9 的中间态），对方修好后我复跑 **exit 0**；
   我这侧的 3 个类型错误（成功拦截器的测试断言 + 集成 spec 的 `findOneAndUpdate({ visitorId })` 调用点）已同步修掉。
3. 我的改动**不含**任何批次 9 的文件；报告里的 path:line 只指向我改的文件。
4. 交付前 `openapi.json` 需要重导出（见 §6），但**当前它已被批次 9 改脏** —— 谁最后收尾谁导，别把两批的 diff 混在一起。

## 1. 结论

| 件 | 验收口径 | 结果 |
|---|---|---|
| **B2** 风控 fail-open 分级 | 敏感端点 fail-close（40667）；其余 fail-open + 可观测留痕；清单唯一真源；新增端点必须显式归类 | 落地；单测 + 扫描对账钉住；负对照 4 条 |
| **B3** 撤 IpFree | 撤掉多余豁免，登录链路不回归 | **4 处全撤**（含 `locale/message`，判据见 §3.2）；G14 改成 5 个探针全 40603 |
| **B6** 心跳行键 | 行键 = 服务端解析的 deviceId；body 的 visitorId 只作校验；同步 DTO 与 api-spec | 落地；劫持负对照 + body deviceId 负对照各 1 条 |

## 2. B2 · 风控 fail-open 分级

### 2.1 现状（改造前为什么不拦）

三个缺口叠成一条「风控一挂 ⇒ 机器人防护完全不执行」的链：

1. `risk.guard.ts` 拿不到 `deviceId` ⇒ `return true`，且**不写** `request.risk`；
2. `risk.guard.ts` 评估抛未知异常 ⇒ 同样 `return true`；
3. `cap.guard.ts` 见 `recommendation === undefined` ⇒ `return true`（日志一句 "allowing request"）。

### 2.2 口径（照 Lead 决定实现）与落点

**按端点敏感度分级，不做全局 fail-close**（本仓没有风控 SLA，全关等于把风控服务变成全站单点）。

| 落点 | 改动 |
|---|---|
| `apps/server/libs/guards/src/guards/risk.sensitivity.ts:75` | **清单唯一真源**：`WALNUT_ADMIN_RISK_ROUTE_SENSITIVITY`（method + path + `fail-close｜fail-open` + 逐条理由）。`/auth/**` 与 `/security/**` **每一个**真实路由都登记（27 条），清单外默认 fail-open |
| 同文件 `:294` | `stripWalnutAdminApiVersionPrefix()`：运行期 `request.path` 带 `/<APP_API_PREFIX>/v<APP_API_VERSION>`，按 env 前缀归一化（多段前缀 `api/w/v1` 也剥，懒惰量词避免误伤业务段 `/v2`） |
| 同文件 `:332` / `:345` | `resolveWalnutAdminRiskSensitivity()` / `isWalnutAdminRiskFailClose()`（带参路由 `:fp` 按单段通配） |
| `.../guards/risk.guard.ts:57` | 新增 `degradeOrReject()`：敏感端点抛 `WalnutAdminExceptionRiskUnavailable`（40667），其余写 `request.riskDegraded` 后放行 |
| `risk.guard.ts:106` / `:160` / `:193` | 三个旧 `return true` 缺口全部改走 `degradeOrReject`（pre-auth 无 deviceId / post-auth 无 deviceId / 未知异常） |
| `.../guards/cap.guard.ts:91-102` | `recommendation === undefined` 分支同样分级：敏感端点 40667，其余 `request.riskDegraded ??= 'risk-recommendation-missing'`（不覆盖 risk guard 写下的更具体原因） |
| `.../guards/interceptors/response/success.interceptor.ts:52` | 留痕通道：`meta.riskDegraded = '<reason>'`（响应壳 `meta`，缺省不传 ⇒ 既有响应零 diff） |
| `packages/platform-any/contract/src/response-code.ts:116` | 新增业务码 `NOT_ACCEPTABLE_RISK_UNAVAILABLE: 40667`（406 家族，刻意与 40666 RiskTooHigh 分开：一个是「算出来太高」，一个是「压根没算出来」） |
| `apps/server/libs/exceptions/src/base/406.ts:118` | `WalnutAdminExceptionRiskUnavailable`；顺带给 406 基类补 `_devMsg` 透传（`:12`），降级原因进响应壳便于排查 |
| `apps/server/libs/utils/src/response.ts` + `libs/types/.../express.d.ts` | `WalnutAdminResponseSuccess(..., meta?)` + `IWalnutAdminExpressRequest.riskDegraded` |
| `apps/server/apps/api/src/i18n/{zh_CN,en_US}/response.json` | `40667` 文案 |

### 2.3 敏感端点清单（fail-close，17 条）

登录 / 注册 / 重置口令 / OTP·MFA 校验 / 签发与刷新凭据 / `security/sign/*`：

- `POST /auth/refresh`；`POST /auth/opaque/user/login/{start,finish}`；
- `POST /auth/opaque/user/register/{start,finish}`；`change-password/{start,finish}`；
- `POST /auth/opaque/admin/password/update/{start,finish}`、`password/clear`；
- `POST /auth/otp/verify`、`POST /auth/mfa/verify`、`POST /auth/google`；
- `GET /auth/oauth/{github,gitee}/callback`；
- `POST /security/sign/initial`、`POST /security/sign/aes-key`。

fail-open 但**逐条写明理由**的：`/auth/signout`（风控挂了必须还能登出）、`/auth/{permissions,keys}`、`/auth/mfa/status`、
`/auth/otp/send`、`/auth/oauth/*/{url,sse/:fp}`、`/security/cap/{challenge,redeem}`、`/security/rsa/public-key`、
`/security/sensitive/{check,verify}`，以及一个意外发现：**`GET /auth`**（`AppController` 挂在根路径，
`@Get(AuthRoutes.BASE)` 的「已认证问候语」演示端点恰好落在 `/auth`，扫描对账会把它算进家族 ⇒ 显式归类并注释）。

### 2.4 「新增端点必须显式归类」的机械闸

`apps/server/libs/guards/src/guards/risk.sensitivity.spec.ts`（新文件，13 条用例）用**纯 fs + 正则零装载**扫描
`apps/api/src/**` 与 `libs/*/src/**` 的全部 `*.controller.ts`（与 `common/monorepo/route-catalog.drift.spec.ts` 同款手法），
重建 `@Controller` 前缀 + 方法装饰器（Get/Post/Put/Patch/Delete/Options/Head/All/**Sse**）的 fullPath 后对账：

| 断言 | 钉住什么 |
|---|---|
| a) 家族内每条真实路由都在清单里 | 新增 `/auth/xxx/login` 忘了归类 ⇒ **红**，报错直接给 `METHOD path (file)` |
| b) 清单里每条 fail-close 都是真实路由 | 删端点忘删清单 ⇒ 红 |
| c) fail-close 集合逐条钉死 | 偷偷把某条改成 fail-open ⇒ 红（改分级必须同时改 spec） |
| d) 家族内 controller 不得用复合路由装饰器 | 否则扫描器会静默漏路由 ⇒ 红 |
| e) 扫描量 > 20 且抽查 3 条 | 防空扫描导致的假绿 |

### 2.5 负对照（改回旧行为 ⇒ 必红）

| 用例（文件：行） | 改回旧行为会怎样 |
|---|---|
| `risk.guard.spec.ts`「敏感端点 + 未知异常 ⇒ 40667」 | 旧写法 `return true` ⇒ 拿到 `null` 而非 40667 ⇒ 红 |
| 同上「敏感端点 + 无 deviceId ⇒ 40667」 | 同上 |
| 同上「非敏感 + 未知异常 ⇒ 放行且 `riskDegraded='risk-evaluation-failed'`」 | 删掉写 `riskDegraded` 那行 ⇒ 红 |
| `cap.guard.spec.ts`「无 recommendation + 敏感端点 ⇒ 40667」 | 旧写法 `return true` ⇒ 无人机验证也能过 ⇒ 红 |
| `success.interceptor.spec.ts`「`riskDegraded` ⇒ `meta.riskDegraded`」 | 拦截器只传三个参数 ⇒ `meta` 恒 undefined ⇒ 红 |
## 3. B3 · 撤掉多余的 IpFree

### 3.1 撤了哪 4 处

| 端点 | 改动位置 | 备注 |
|---|---|---|
| `POST /security/sign/initial` + `POST /security/sign/aes-key` | `apps/server/apps/api/src/modules/security/sign/sign.controller.ts:36`（类级装饰器删除） | 一次撤两个端点 |
| `GET /system/locale/message/:locale` | `apps/server/apps/api/src/modules/system/locale/locale.controller.ts:163` | 见 §3.2 判据 |
| `GET /system/user/preference/read` | `apps/server/apps/api/src/modules/system/identity/user_preference.controller.ts:31` | |

撤后全仓 `@WalnutAdminGuardIpFree()` **0 处调用**（`grep IpFree apps/server/apps/api/src` 只剩注释）。
装饰器与 guard 实现本身保留（`libs/guards/src/guards/ip.guard.ts`），以便将来确有豁免需求时仍有单一开关 —— 但见 §7 的反面意见。

### 3.2 `locale/message` 为什么也撤（Lead 留的选择题）

**结论：匿名语言包不需要在 IP 黑名单之外。** 三条判据：

1. **内容是公开静态文案**：`locale/message` 返回「消息 key → 译文」映射，同一份内容就在仓库里
   （`apps/server/apps/api/src/i18n/**` + `sys_locale` 种子）。拒绝黑名单 IP 不损失任何机密性，
   它唯一的价值是「黑名单 IP 还能拿到一份公开字典」—— 那正是漏洞侧的收益，不是我们侧的。
2. **同族匿名引导端点早就在 IP 强制下正常работают**：`device/initial`、`lang/list/public`、`setting/public`
   都是匿名、都在引导期、都没跳 IP，上线至今没有问题 ⇒ 「引导期必须跳 IP」这个前提不成立。
3. **IP 黑名单没有中间件兜底**：`WalnutAdminGuardIP` 是**唯一**执行点（`apps/server/apps/api/src/middleware/`
   下没有 IP 黑名单中间件）。每个 IpFree 都是端点上显式挖掉的洞，而 `security/sign/*` 长期豁免的
   实际效果是「被拉黑的 IP 仍能完成签名握手」。

代价（如实登记）：被拉黑 IP 的**错误页失去译文**（只能拿到 `response.40603` 这个 key）。
因为拉黑同时封掉了登录，这类客户端本来也走不到任何业务页 —— 属既有「拉黑即全站拒绝」语义的自然延伸。
另外注意：**失败登录会触发临时拉黑**（`libs/security/src/risk/modules/failedLogin.service.ts:71`），
所以「同 NAT 出口的办公室被同事/机器人牵连」时会整段 TTL 拿到 40603 —— 这条改造前后一致（登录本来就受 IP guard），
只是现在连语言包一起拒。

### 3.3 回归钉子（G14 重写）

`apps/server/apps/api/test/api/guard-matrix.api-spec.ts:996` 原用例断言「拉黑 IP 打 `security/sign/initial` ⇒ **20000**」
（把豁免当现状钉死）。现在改成 5 个探针全 **40603**：

```text
对照（从未 IpFree）  GET  /security/rsa/public-key
sign/initial        POST /security/sign/initial
sign/aes-key        POST /security/sign/aes-key
locale/message      GET  /system/locale/message/zh_CN
user/preference/read GET /system/user/preference/read
```

**负对照**：把任意一处 `@WalnutAdminGuardIpFree()` 加回去，对应探针不再是 40603 ⇒ 用例红
（改造前 `sign/initial` 与 `aes-key` 就是 20000）。

文档同步：`apps/server/apps/api/test/api/ENDPOINTS.md:550`、`apps/docs/.../backend/modules/security.md:21`（标注「当前 0 处调用」）、
`apps/docs/.../backend/modules/auth.md:82`（签名握手段落原本写着 IpFree）。

## 4. B6 · 心跳端点行键改为服务端解析的 deviceId

### 4.1 漏洞

`POST /app/monitor/user/state` 改造前的写腿（`libs/app-domain/src/monitor/user/user.service.ts`）：

```ts
findOneAndUpdate({ visitorId: dto.visitorId }, { deviceId, ...updatePayload }, { upsert: true })
```

行键 = **请求体**的 `visitorId`，写进那行的 `device_id` = Cookie 里的设备 ⇒ 任何人把别人的指纹塞进 body，
就把别人那一行的 `device_id` 改成自己的设备（顺带覆盖 focus / left / currentRouter / user_id）。
另有一条同源的坑：`{ deviceId, ...updatePayload }` 的展开顺序让**请求体里的 deviceId** 能盖掉 Cookie 值。

### 4.2 改法

| 落点 | 改动 |
|---|---|
| `libs/app-domain/src/monitor/user/user.service.ts:61` | `updateState(deviceId, dto, em)`：① 行键改成入参 `deviceId`；② **`HMAC(visitorId) === deviceId` 校验**（`getDeviceIdByFingerprint`，与 `device/initial` 铸号同一条腿），对不上 40099 且**不写库**；③ `delete updatePayload.deviceId`（请求体不得声明行键） |
| `libs/app-domain/src/monitor/user/repo/user.repo.service.ts` | `findOneAndUpdate(filter: { deviceId }, ..., { upsert })` —— filter 类型即契约（传 `{ visitorId }` 现在编译不过） |
| `apps/api/src/modules/app/monitor/user/dto/user.dto.ts:98` | `AppMonitorUserDTOUpdateState` 的 pick 列表**摘掉 `deviceId`**（服务端解析字段不可客户端声明）+ 注释同步 visitorId 的「只作校验」语义 |
| `apps/api/src/modules/app/monitor/user/user.controller.ts:144` | 注释钉住「`@WalnutAdminDecoratorDeviceId()` 就是行键」 |

为什么校验用 **HMAC 相等**而不是「与库里已存行比」（第一版写的是后者，改掉了）：只比已存行会**漏掉首行登记**这一腿 ——
攻击者可以抢在受害者之前用自己的 deviceId 建行、`visitor_id` 填受害者指纹，之后受害者自己的 upsert 会撞
`uq_monitor_visitor`（23505 → 40000），心跳永久坏掉。HMAC 相等不依赖行是否存在，且对真实客户端恒成立 ——
前端两处指纹是**同一个值**：axios 的 `FINGERPRINT` 头（`apps/admin/src/utils/axios/interceptors/request/interceptor.ts:21`）
与心跳 body 的 `visitorId`（`apps/admin/src/hooks/web/useMonitor.ts:57`）都取 `appStoreFingerprint.getFingerprint`
（`apps/admin/src/store/modules/app/app-fingerprint.ts:138/175`）。

`deviceId` 从 DTO 摘除的连带效果：客户端再传 `deviceId` 会被全局 `ValidationPipe`（`whitelist + forbidNonWhitelisted`）
判成 **40099**，而不是像改造前那样「写进 payload 再被 cookie 值覆盖」——胜负由展开顺序决定的写法一并消失。

### 4.3 负对照（改回旧行为 ⇒ 必红）

| 用例 | 钉住什么 |
|---|---|
| `libs/app-domain/.../user.service.spec.ts:62`「filter 按入参 deviceId」 | 改回 `{ visitorId }` ⇒ 红（就是漏洞本身） |
| 同文件「指纹不属于本设备 ⇒ 40099 且**不写库**」 | 删掉 HMAC 校验 ⇒ 红 |
| 同文件「请求体夹带的 deviceId 被丢弃」 | 删 `delete updatePayload.deviceId` ⇒ 红 |
| `apps/api/test/api/monitor-user.api-spec.ts:153`「拿别人的指纹上报 ⇒ 40099，受害者那一行一个字段都不动」 | 行键回退成 visitorId ⇒ 攻击者会把受害者的 `device_id`/`current_router` 改掉 ⇒ 红 |
| 同文件 `:183`「body 里的 deviceId 不再可写」 | 把 `deviceId` 加回 DTO pick ⇒ 20000 且落库 ⇒ 红 |
| 集成 `device.user-device.monitor.pg.int-spec.ts`「deviceId upsert（先插后改）」 | 行键改回 visitorId ⇒ 二次写不再按设备命中 ⇒ 红 |

### 4.4 顺带修掉的测试基础设施问题

行键换成 deviceId 后，「一条 spec 用同一个 client 报两个不同指纹」不再可能（同 client = 同 device = 同指纹）。
`monitor-user.api-spec.ts` 因此引入第二台真实客户端 `guest`（完整 device/CAP/签名握手），并把清理腿改成
`DELETE ... WHERE device_id = ANY(...)`。api-spec 里所有 `visitorId` 现在都取 `client.fingerprint`
（= 真实客户端 axios 头里的那个值），否则 HMAC 校验必然 40099。
## 5. 验收读数（本机、独占跑）

| 命令 | 结果 | 说明 |
|---|---|---|
| `pnpm --filter @walnut/server test` | **822 passed / 98 files**（exit 0） | 日志 `reports/batch-8/logs/server-test.log`。Lead 给的基线是 790 —— 差额里含我新增的 32 条单测 + 批次 9 同期新增的用例（同一工作树，见 §0） |
| `pnpm --filter @walnut/server types:check` | **exit 0** | 期间一度红在两个 number 文件（批次 9 中间态），对方修好后复跑绿 |
| `pnpm --filter @walnut/server lint` | **0 error**（3 个 warning 在批次 9 的 `libs/repository/src/pg-list.builder.spec.ts`） | 日志 `logs/lint-server.log`；我改的文件已 `--fix` 复跑 |
| `pnpm --filter @walnut/docs lint` | exit 0 | 我改了两篇文档（auth.md / security.md） |
| `pnpm boundaries` | **Checked 4681 files in 15 packages, no issues found** | |
| `pnpm --filter @walnut/contract test` | 27 passed | 新增业务码 40667 后复跑（快照已在 `index.test.ts.snap`） |
| `pnpm --filter @walnut/server test:integration` | 见 §5.1 | 独占：先确认本仓 0 个其它 vitest 进程，且 globalSetup 打印「已拿到排他锁」|

### 5.1 集成读数

INTEGRATION_PLACEHOLDER
## 6. 已知边界 / 未做

1. **`openapi.json` 需要重导出**（本批改了两处契约面：心跳 body 少了 `deviceId`、新增业务码 40667 会进
   每个 200 响应的 `code` enum）。交付时它**已被批次 9 改脏并提交**，我不能在里面混入自己的 diff —— 谁最后收尾谁跑
   `pnpm openapi:export && pnpm openapi:generate`（`packages/generated/api-types/src/schema.d.ts` 会跟着变）。
2. **`_devMsg` 只在 dev 落盘**（`libs/utils/src/response.ts:18` 的 `isDev` 门）。所以生产里 40667 的**唯一**可见信号是业务码本身；
   降级原因（`no-device-id` / `risk-evaluation-failed @ POST /auth/refresh`）只进日志与 `_devMsg`（dev）。
   非敏感端点的留痕不受影响（`meta.riskDegraded` 恒落响应壳）。
3. **历史脏行不会自动修复**：改造前被投毒的行（`visitor_id` 属于 A、`device_id` 属于 B）仍在表里。受害者**新**上报会撞
   `uq_monitor_visitor`（23505 → 40000）直到那一行被清。判据（`HMAC(visitor_id) === device_id`）算不了 SQL —— key 在 env。
   见 §7 第 4 条。
4. **未做**：risk 服务「慢而不失败」没有超时/熔断（本批只处理「抛异常」与「无 deviceId」两种不可用形态）。
5. **未做**：`/app/error` 的 ErrorMap 没登记 40667（与既有的 40608/40609/40610 同形：未登记就抛 50000）。
6. **未做**：`libs/guards/src/guards/ip.guard.ts` 的 `@WalnutAdminGuardIpFree()` 现在是 0 调用导出，knip 迟早会点它（见 §7 第 5 条）。

## 7. 需要 Lead 拍板

1. **`POST /auth/otp/send` 要不要一起 fail-close**：我按你的列表**严格**口径记成 fail-open（理由：它不是「校验」，且有独立
   `OtpDecoratorThrottle` 兜底）。但风控缺席时它仍是**匿名发码**入口（SMS 成本 + 账号枚举面）。改成 fail-close 是一行
   （`risk.sensitivity.ts` 表里把 `fail-open` 改 `fail-close`）+ 改 `risk.sensitivity.spec.ts` 的 fail-close 钉。
2. **`POST /security/sensitive/verify`（敏感操作第二因子增强）** 同理：不在你的列表里 ⇒ 我记 fail-open。要不要一起收进 fail-close？
3. **40667 这个新码**：新加了 `NOT_ACCEPTABLE_RISK_UNAVAILABLE: 40667`（contract + i18n 双语 + 异常类）。
   替代方案是复用 40666（但语义是「算出来太高」，会误导值班）或 50302（依赖不可用，但 ≥50000 会**每条请求都进错误库**，
   风控挂掉时正好是登录高峰 ⇒ 噪声）。如果你不想动 contract，退回 40666 是一行改动。
4. **历史脏行清理**：需要一条一次性 repair（人工确认后执行），建议 SQL 形态：
   `SELECT id, device_id, visitor_id FROM app_monitor_user WHERE device_id IS NULL OR visitor_id IS NULL;`
   再按「在线列表里 device 与 user 明显对不上」的行人工核。**不要**自动删（`force-quit` 依赖这些行做 revoke）。
5. **`@WalnutAdminGuardIpFree()` 装饰器留不留**：现在 0 调用。留着 = 将来确有豁免需求时仍有单一开关（但也会被再次误用）；
   删掉 = knip 清静、缺口从编译期消失。我倾向**留着但写进 AGENTS 的反面清单**（「加 IpFree 前先证明同族端点也跳 IP」）。
6. **`openapi.json` / `api-types` 的重导出归属**：见 §6-1。它现在是批次 9 的 diff，本批的契约变更叠在同一文件上，
   建议**两批都落地后**由你统一导一次，避免互相覆盖。
7. **文档里的旧计数**：`apps/docs/.../industry-research/backend-architecture-review/10-implementation-plan.md:305` 写着「3 处多余 IpFree」，
   实际是 4 处（我全撤了）。这篇属冻结语料（`ignoreDeadLinks` 白名单），我没动；要改的话得你确认是否解冻。

## 8. 文件清单（本批新增/改动，均为相对仓库根）

新增：

- `apps/server/libs/guards/src/guards/risk.sensitivity.ts`（分级清单 + 前缀归一化 + 解析器）
- `apps/server/libs/guards/src/guards/risk.sensitivity.spec.ts`（扫描对账 13 条）
- `apps/server/libs/guards/src/interceptors/response/success.interceptor.spec.ts`（留痕通道 4 条）
- `apps/server/libs/app-domain/src/monitor/user/user.service.spec.ts`（行键/校验 5 条）

改动（代码）：

- `apps/server/libs/guards/src/guards/risk.guard.ts` / `cap.guard.ts` / `guards/index.ts`
- `apps/server/libs/guards/src/interceptors/response/success.interceptor.ts`
- `apps/server/libs/utils/src/response.ts`、`apps/server/libs/types/src/walnut-admin/express.d.ts`
- `apps/server/libs/exceptions/src/base/406.ts`、`packages/platform-any/contract/src/response-code.ts`（+ 快照）
- `apps/server/apps/api/src/i18n/{zh_CN,en_US}/response.json`
- `apps/server/apps/api/src/modules/security/sign/sign.controller.ts`、`.../system/locale/locale.controller.ts`、`.../system/identity/user_preference.controller.ts`（IpFree）
- `apps/server/libs/app-domain/src/monitor/user/{user.service.ts,repo/user.repo.service.ts,dto/user.dto.ts}`、`apps/server/apps/api/src/modules/app/monitor/user/{dto/user.dto.ts,user.controller.ts}`（B6）

改动（测试 / 文档）：

- `apps/server/libs/guards/src/guards/risk.guard.spec.ts`、`cap.guard.spec.ts`
- `apps/server/apps/api/test/api/monitor-user.api-spec.ts`、`guard-matrix.api-spec.ts`、`helpers/api-client.ts`
- `apps/server/apps/api/test/integration/device.user-device.monitor.pg.int-spec.ts`、`apps/server/apps/api/test/api/ENDPOINTS.md`
- `apps/docs/src/zh-CN/content/backend/modules/{auth,security}.md`

> 提交状态：协调方已把本批代码刀在 `570b7448 feat(server): 风控按端点分级 fail-close、撤掉多余 IpFree、心跳行键改服务端 deviceId`；
> 我在那之后又补了「B2 的 3 条真实 HTTP 钉（guard-matrix）+ 测试响应壳类型补 `meta`」与最终集成日志，这部分**未提交**。
