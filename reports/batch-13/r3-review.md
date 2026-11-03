# 批次 13 · R3 独立复核：文档与事实对齐（13-A/B/C/D）

> 复核对象：工作树里**唯一一份未 commit 的 R2 成果**（基线 `534667e1` 之上）。
> 复核方式：**先读源码，再读文档**，逐条比断言与代码；门禁**全部自己重跑**，读数以本轮为准。
> 未修改任何被跟踪文件，未 commit / stash / restore，未联网，未跑 vitest，未重启服务。
> 本文件是本次复核唯一产出。

---

## 0. 结论：**不可提交**（2 处必须修，均在 .md 内）

| 级别 | 条目 | 位置 |
|---|---|---|
| **必须修 P0** | 重写后的 `shared/device.md` 里，mermaid 图仍写「deviceName **只在插入时**由服务端生成」，与同文件 §3 的「每次 initial 重新生成、不区分新建还是复用」**自相矛盾**，且与代码相反 —— 这正是本批自报的头部纠错点 | `apps/docs/src/zh-CN/content/shared/device.md:169` |
| **必须修 P1** | 并发语义写「失败侧是受控拒绝（**40605** 或 42900 限流）」，而它引用的 `concurrency.api-spec.ts` G3 断言的失败侧是 **40000 / 42900**，40605 不在允许集里 | `apps/docs/src/zh-CN/content/backend/modules/system-account.md:92-93` |

两处都是**纯 .md 改动**，修完不破坏「diff 只含 md」这条验收。

另有 1 处「建议本批内修」（`system-data.md:197` 仍用旧键名 `SYS_DEVICE:`，与刚改成 `SYSTEM:DEVICE:` 的四篇自相矛盾）、
2 处「留到下一批」（`steps.ts:405` 的「11 段」、R2 报告里的 17 → 实为 18）。

---

## 1. 机械核验：diff 是否「纯 md」

全部命令在仓库根 `D:\walnut-admin\walnut-admin` 执行，pwsh。

```text
$ git status --porcelain=v1
 M AGENTS.md
 M README.md
 M apps/docs/src/zh-CN/content/backend/modules/app-shared.md
 M apps/docs/src/zh-CN/content/backend/modules/auth.md
 M apps/docs/src/zh-CN/content/backend/modules/security.md
 M apps/docs/src/zh-CN/content/backend/modules/system-account.md
 M apps/docs/src/zh-CN/content/monorepo/knip.md
 M apps/docs/src/zh-CN/content/monorepo/reference-repo-comparison.md
 M apps/docs/src/zh-CN/content/monorepo/release.md
 M apps/docs/src/zh-CN/content/plans/libs-decoupling-residuals.md
 M apps/docs/src/zh-CN/content/plans/postgres-migration-phase2.md
 M apps/docs/src/zh-CN/content/review/backend/index.md
 M apps/docs/src/zh-CN/content/shared/device.md
 M apps/docs/src/zh-CN/content/shared/sign.md
 M apps/server/AGENTS.md
?? reports/batch-13/
```

| 断言 | 命令 | 结果 | 判定 |
|---|---|---|---|
| 改动文件数 = **15** | `git diff --name-only \| Measure-Object` | **15** | ✅ 与 R2 自述一致 |
| 非 .md 改动 = 0 | `git diff --name-only \| Where-Object { $_ -notmatch '\.md$' }` | 空 | ✅ |
| 暂存区干净 | `git diff --cached --name-only` | 空 | ✅ 没有偷偷 add |
| `openapi.json` 零 diff | `git diff --name-only -- apps/server/openapi.json` | 空 | ✅（真实路径是 `apps/server/openapi.json`；任务里给的 `apps/server/apps/api/src/common/openapi.json` **不存在**，用那个路径查会「通过得毫无意义」） |
| `schema.d.ts` 零 diff | `git diff --name-only -- packages/generated/api-types/src/schema.d.ts` | 空 | ✅ |
| 整目录生成物零 diff | `git diff --stat -- packages/generated/` | 空 | ✅ |
| diff 规模 | `git diff --stat \| Select-Object -Last 1` | `15 files changed, 346 insertions(+), 303 deletions(-)` | ✅ 与 R2 §5.3 逐字一致 |

`reports/batch-13/` 是未跟踪目录（`?? `），按任务说明属预期，不计违规。
**未发现任何 .ts / .json / 生成物改动**，也**没有**任何 .md 之外的路径出现在 diff 里。

---

## 2. 门禁重跑（全部真实 exit code）

pwsh 的执行策略拦 `.ps1`，因此一律 `cmd /c "pnpm …"`；docs build 给 `timeoutMs 300000`。

| 命令 | exit | 门禁自己打印的读数 | 与 R2 自述比 |
|---|---|---|---|
| `pnpm lint:docs-refs` | **0** | 353 篇活文档；包名豁免 17 条、路径豁免 8 条 | ✅ 一致 |
| `pnpm lint:doc-ts` | **0** | 230 篇活文档里的 124 个 ts 块 + 3 个 json 块 | ✅ 一致 |
| `pnpm lint:doc-budget` | **0** | 6 个常驻文件：`87% 7579/8700 AGENTS.md`、`89% 1250/1400 CLAUDE.md`、`89% 1789/2000 monorepo/index.md`、`88% 2189/2500 apps/admin/AGENTS.md`、`87% 4024/4600 apps/docs/AGENTS.md`、`88% 6038/6900 apps/server/AGENTS.md` | ✅ 六个数逐位一致（含 7579 / 6038） |
| `pnpm lint:adr` | **0** | 27 篇 ADR，编号连续 / 状态枚举 / 四小节 / index 双向对齐 | ✅ 一致 |
| `pnpm lint:emoji` | **0** | 1218 个被跟踪文本文件，常驻 6 个走严格档 | ✅ 一致 |
| `pnpm build:docs` | **0** | `Found 254 files` / `Indexed 247 pages / 14184 words` / `build complete in 66.52s` | ✅ 三个数一致；耗时 58.39s→66.52s 属机器差异，非读数差异 |
| （补充）`pnpm lint:workflows` | **0**（SKIP） | `⚠ 未检测到 actionlint，跳过 workflow 校验（CI 中会强制执行）` | ✅ 证实本批 13-C 的「SKIP ≠ PASS」口径是**事实**，不是措辞偏好 |

> 补一条自证：**本文件写完之后**再跑一次 `lint:docs-refs`，读数从 353 变 **354**（`r3-review.md` 也是活文档、包名照查），
> 仍然 exit 0。这正好解释了 R2 的 353 = 351（R1 读数）+ `r1-docs.md` + `r2-docs.md` 这条推算是对的。

**结论：五道 doc 门禁 + docs build 全绿，读数与 R2 自述没有任何差异。**
唯一需要记的差别：`lint:workflows` 在这台机器上 exit 0 但**一行 workflow 都没校验**，所以它**不能**计入「全绿」——
本批改后的 `review/backend/index.md:399-403` 与 `libs-decoupling-residuals.md:71,136-137` 正是这么写的，口径正确。

---

## 3. 事实核对表（55 条，逐条带 path:line）

行号是**当前工作树**的。判定只有三种：✅ 对 / ⚠️ 不精确 / ❌ 错。

### 3.1 设备身份（13-A 的核心）

| # | 文档位置 | 断言 | 源码依据 | 判定 |
|---|---|---|---|---|
| 1 | `shared/device.md:62` | 形态 `d1_` + 32 位小写 hex | `libs/const/src/app/device.ts:16` `/^d1_[0-9a-f]{32}$/` | ✅ |
| 2 | `shared/device.md:62` | 前缀常量 `WALNUT_DEVICE_ID_PREFIX` | `const/src/app/device.ts:19`；`system/src/device/device-id.ts:16` 再导出 | ✅ |
| 3 | `shared/device.md:18-19` | 判据唯一真源是 `isValidDeviceId`，cookie 读取与 initial 复用判定都调它 | `device.guard.ts:96`、`device.service.ts:108`（两处都调 `isValidDeviceId`）| ✅ |
| 4 | `shared/device.md:63-64` | `generateDeviceId()` 只调 `randomBytes(16)`，不碰密钥 | `device-id.ts:23-25` | ✅ |
| 5 | `shared/device.md:65-66` | **签发点只有 initial 一处** | 全仓 grep `generateDeviceId`：生产代码唯一调用点 `device.service.ts:108`（其余是 spec / int-spec / 注释）| ✅ 文档对；`device-id.ts:20` 的注释「只在两处调用…登录成功时」**已过期**（R2 已登记，属 13-E）|
| 6 | `shared/device.md:23-24`、`security.md:280`、`auth.md:47-48`、`system-account.md:79-81` | initial 的**幂等键是已有合法 cookie** | `device.service.ts:107-108` | ✅ |
| 7 | `shared/device.md:76-78`、`security.md:282-283`、`system-account.md:87-89` | **deviceName 每次 initial 重新生成并覆盖（新建/复用都一样）**，客户端不可传 | `device.service.ts:94-96`（`<type>_<8hex>`）、`:126`（`deviceData.deviceName`）、`device.basic.repository.ts:46-52`（`Object.assign(existing, deviceData)` 后 save）| ✅ **R2 对，R1 错**（R1 与旧文档都写「只在插入时写入」）|
| 8 | `shared/device.md:169`（mermaid 图 1） | 「deviceName **只在插入时**由服务端生成」 | 同上：命中已有行时 `Object.assign` 会覆盖 `deviceName` | ❌ **错，且与同文件 :76-78 冲突** → 必须修 |
| 9 | `shared/device.md:77-78`、`system-account.md:88-89,412` | 请求体带 `deviceName` ⇒ 40099 | `device.dto.ts:211`（`RealPickType(…['sr','vp','hardwareInfo','deviceInfo','private'])`，无 deviceName）；`apps/api/src/main.ts:136-149`（whitelist + forbidNonWhitelisted + exceptionFactory → `WalnutAdminExceptionRequestDataError`）；`contract/src/response-code.ts:30`（40099）| ✅ |
| 10 | `device.controller.ts` 相关文档（`device.md:175`、`security.md:286`、`system-account.md:412`） | initial 响应是**拍平** `{deviceId, latitude?, longitude?, countryCode?}` | `device.controller.ts:83-88`；DTO `device.dto.ts:225-260`（注释明说旧版声明了从未下发的字段）| ✅（service 返回的 `{deviceId, locationInfo}` 是内部形状，文档已改对）|
| 11 | `device.md:159` | initial 的 Sign / JWT / CAP / Device 全 Free，Throttle 生效，Risk 仍运行 | `device.controller.ts:54-57,63`（四个 Free + `@WalnutAdminDecoratorThrottle(SysDeviceSettingService)`，无 RiskFree）| ✅ |
| 12 | `security.md:273-274`、`system-account.md:76-78`、`auth.md:45` | Throttle 4 次 / 60 秒 | `libs/system/src/device/device.setting.service.ts:11-22`（limit=4、ttl=60）| ✅ |
| 13 | `device.md:125`、`security.md:304` | cookie 30 天 maxAge + **80% 窗口**滑动续期，两值同源 | `const/src/app/cookie.ts:39`（30d）、`:42`（`Math.floor(maxAge*0.8)`）| ✅ |
| 14 | `device.md:126`、`security.md:303-305`、`system-account.md:114-116` | 续期闸键 `SYSTEM:DEVICE:COOKIE_RENEW:<deviceId>`，TTL=续期间隔，窗口内不重复 Set-Cookie | `const/src/app/cache.ts:36`；`cache/src/service/device.cache.ts:63-88`（`setIfAbsent` + `ttl=ceil(renewInterval/1000)`）| ✅ |
| 15 | `device.md:126`、`security.md:301`、`system-account.md:116` | 只在**校验全通过**之后才重发 | `device.guard.ts:160-161`（banned/locked 抛错之后）| ✅ |
| 16 | `device.md:253-254` | cookie 恒 `secure`；SameSite prod `None`、dev/stage `Lax`；httpOnly + signed | `libs/cookie/src/cookie.service.ts:12-59`（三个分支都 `secure:true`；dev/stage `lax`、prod `none`、`signed` 默认 true）；prod 另加 `domain` | ✅（旧文档写 `Strict` 是错的，本批已改对）|
| 17 | `device.md:172`、`security.md:287,293`、`auth.md:51`、`system-account.md:106` | 设备缓存键 `SYSTEM:DEVICE:<deviceId>`（不是 `SYS_DEVICE:`）| `const/src/app/cache.ts:34`（`SYS_DEVICE: 'SYSTEM:DEVICE'`）+ `device.cache.ts:33` | ✅ 四篇都改对了 —— 但 **`backend/modules/system-data.md:197` 仍写 `SYS_DEVICE:<deviceId>`**（见 §5.3）|
| 18 | `device.md:105-106`、`security.md:291-293`、`system-account.md:103-109` | 形态非法 / 缺失 → 40605；缓存 miss 回源仍查无 → 40605 | `device.guard.ts:94-99`、`:109-124` | ✅ |
| 19 | `device.md:96`、`security.md:297`、`system-account.md:112` | 先判 `banned`(40607) 再判 `locked`(40606)；**无 DEVICE_INACTIVE 分支** | `device.guard.ts:150-158`（顺序如此，且 handler 里没有任何 `active` 判定）；码值 `contract/src/response-code.ts:104,106` | ✅ |
| 20 | `device.md:116-117` | 统一响应壳是 **HTTP 200 + body.code**，40605 是业务码不是 HTTP 状态 | `libs/exceptions/src/exception.filter.ts:93`（`response.status(HttpStatus.OK).json(responseData)`）| ✅ |
| 21 | `device.md:93`、`security.md:301-302`、`system-account.md:110-112` | 封禁 = 踢下线：同事务撤该设备全部 RT，提交后清会话键 + 断 WS；解禁不踢 | `device.service.ts:271-277`（`patch.banned === true` 才 `kickDevice`）；`modules/system/device/shared/device.kick.service.ts:17-38`（RT 与封禁同事务，`kickDeviceOffline` 清会话 + `kickDeviceSockets`）| ✅ |
| 22 | `device.md:94`、`security.md` §4.1 段 | `stale` 不参与鉴权；initial 时清标 | `device.repo.service.ts:58-89`（只写 stale/active，注释明说「stale 不参与鉴权」）；`device.service.ts:153-155`（`stale: false`）| ✅ |
| 23 | `device.md:129-132` | 90 天留存判据「**四条**同时满足」 | `device.repo.service.ts:119-136`：`active=false` + `updated_at<cutoff` + `banned=false` + `locked=false` + NOT EXISTS monitor 行 + NOT EXISTS 未撤销未过期 RT —— 实际是 **5 组谓词**（monitor 与 RT 是两条独立的 NOT EXISTS）| ⚠️ **不精确**：建议改「五条」或把 monitor/RT 写成并列的一项 |
| 24 | `device.md:134`、`security.md` §4.2 段 | 天数不在 SQL 里写死，由 cron 算 cutoff 传入 | `device/repo/device.pg.purge.service.ts:13`（`DEVICE_RETENTION_DAYS = 90`）、`:70,74`（`new Date(Date.now()-90d)` 传入）| ✅ |
| 25 | `device.md:113`、`security.md:284`、`system-account.md:54-57`、`phase2.md:311,335-336` | DB 侧 CHECK 名 `ck_device_device_id_form`，migration `1793390000000`，加在旧 64 hex 清空之后 | `apps/api/migrations/1793390000000-DeviceIdFormCheck.ts:43`（约束名）、`:46`（`^d1_[0-9a-f]{32}$`）、`:19-32`（注释：清理走 pre-step，本 migration 不动数据）| ✅ 名字/取值/时机三处都对 |
| 26 | `device.md:82-84`、`security.md:299-300`、`system-account.md:111-112` | IP / 位置历史两段**等长**，上限写在各 `arrayOptions.maxSize`，与 repo 裁剪是同一规则（改一处得改两处）| `device.dto.ts:60-70`（locationHistory maxSize 5）、`:93-105`（ipHistory maxSize 5）；`device.repo.service.ts:255-259`（`length > 5` 时两个数组同时 shift）| ✅ 措辞已从「最多 5 条」改成判据式；风险（无门禁绑定）R2 已自登记 |
| 27 | `device.md:55-56`、`app-shared.md:213-219,407` | 心跳行键 = 服务端从签名 cookie 解析的 deviceId；`visitorId` 只与**本设备已存行**比，不一致 40099 且不写库，首写登记 | `libs/app-domain/src/monitor/user/user.service.ts:96-104`（`findFirstByDeviceId` → `boundRow.visitorId !== visitorId` → 40099；异常在 `findOneAndUpdate` **之前**抛，故不写库）、`:108-113`（`{ deviceId }` 为行键）、`:91`（`delete updatePayload.deviceId`）| ✅ 文档与代码一致，且明确不是 `HMAC(visitorId)===deviceId` |
| 28 | `app-shared.md:407` | 心跳 body 带 `deviceId` ⇒ 40099；`userId` 只采信验签 AT | `apps/api/src/modules/app/monitor/user/dto/user.dto.ts:98-110`（deviceId 已从白名单摘除；注释写明 whitelist+forbidNonWhitelisted ⇒ 40099）；`user.controller.ts:77,155`（`resolveVerifiedUserId`）| ✅ |
| 29 | `app-shared.md:210` | 行键是 `device_id`（`idx_monitor_device`）；`visitor_id` 唯一约束只保证「一个指纹只落一行」 | `migrations/1792922206018-InitSchema.ts:177-178`（`uq_monitor_visitor` UNIQUE、`idx_monitor_device` 普通索引）| ✅ |
| 30 | `device.md:91` | `active` 由心跳与 cron 维护 | `user.service.ts:124`（`updateDeviceActive(deviceId, !doc.left)`）| ✅ |
| 31 | `device.md:105` | 40605 自愈：清本地缓存 → initial → 重放；**同一请求只自愈一次**，并发由 SingletonPromise 收敛 | `apps/admin/src/utils/axios/interceptors/response/interceptor.ts:114-120`（`_deviceResetRetried` 守卫 + `await SingletonPromiseDeviceReset()`）；`response/device.ts:18-24`（`SingletonPromise` + `resetDeviceId`）；`types.d.ts:18`（「只做一次的标记，防死循环」）| ✅ |
| 32 | `device.md:67-68` | 前端持久化键 `AppConstPersistKey.GEO_IP_DEVICE_ID`，只为「已初始化过就别再 initial」 | `apps/admin/src/const/persistent.ts:27`；`store/modules/app/app-geo-ip.ts:11` | ✅ |
| 33 | `device.md:229-231` | 签名侧以 deviceId 为键（`SECURITY:RSA:PUB_KEY:<deviceId>` / `SECURITY:SIGN:AES_KEY:<deviceId>`），换身份要重新握手 | `const/src/app/cache.ts:25,27` | ✅（任务里那条更长的自愈链「40605→initial→40012→sign/initial→40113→sign/aes-key→20000」文档**没写**；我核过它的每跳都真实存在：40012=`BAD_REQUEST_RSA_PUB_KEY_NOT_FOUND`(`response-code.ts:27`)、40113=`UNAUTHORIZED_EXPIRED_SIGNATURE`(`:61`)、`/security/sign/initial`(`routes.ts:144`)、`/security/sign/aes-key`(`:145`) —— 属**未覆盖**，不是错）|
| 34 | `device.md:239` | 会话键 `AUTH:SESSIONS:{userId}:{deviceId}:{sessionId}` | `const/src/app/cache.ts:16`（`AUTH_SESSIONS: 'AUTH:SESSIONS'`）+ `auth/src/modules/jwt/jwt-access.strategy.ts:13`（键形态注释）| ✅ |
| 35 | `device.md:14-15` | 16 字节 = 128 bit 熵 | `device-id.ts:24`（`randomBytes(16).toString('hex')` → 32 hex）| ✅ |
| 36 | `system-account.md:92-93` | 并发同 cookie 失败侧是「**40605** 或 42900 限流」，见 `concurrency.api-spec.ts` G3 | `apps/api/test/api/concurrency.api-spec.ts:245`（用例名：冲突 **40000** / 限流 42900）、`:284-288`（允许集 = 20000 / **40000** / 42900）；`device.service.ts:179-186`（23505 → **40000**，其余 → 40605）| ❌ **错**：应为 40000（uq_device_id 冲突）/ 42900 → 必须修 |
| 37 | `sign.md:41` | 设备 id 由服务端随机签发；「不可伪造」的来源是签发权而非哈希 | `device-id.ts:11-13,23-25` | ✅ |
| 38 | `sign.md:285` | 指纹解耦 ⇒ 同一指纹的多台设备无关联判据 | `device.repo.service.ts:38-49`（`getDeviceIdByFingerprint` 已是「历史工具，身份路径 0 调用」）| ✅ |

### 3.2 风控分级 / CAP（13-D）

| # | 文档位置 | 断言 | 源码依据 | 判定 |
|---|---|---|---|---|
| 39 | `security.md:331-346` | 敏感端点 fail-close → **40667**（`NOT_ACCEPTABLE_RISK_UNAVAILABLE`）；40666 是「分数太高」 | `contract/src/response-code.ts:114-116`；`exceptions/src/base/406.ts:98,118` | ✅ |
| 40 | `security.md:336` | fail-close 时 `_devMsg` = `<reason> @ <METHOD path>`，不进响应壳 | `guards/src/guards/risk.guard.ts:57-63`（```new WalnutAdminExceptionRiskUnavailable(`${reason} @ ${routeKey}`)```；`routeKey` = `METHOD path`，见 `risk.sensitivity.ts:350-351`）| ✅ |
| 41 | `security.md:337` | 三个降级原因值 `no-device-id` / `risk-evaluation-failed` / `risk-recommendation-missing` | `risk.sensitivity.ts:48-51`；写入点 `risk.guard.ts:66,106,160,193` | ✅ |
| 42 | `security.md:344-345` | `meta.riskDegraded` 是可选字段，只在非 `undefined` 时带 ⇒ 既有响应零 diff | `guards/src/interceptors/response/success.interceptor.ts:52-56` | ✅ |
| 43 | `security.md:340-343` | 清单唯一真源 `risk.sensitivity.ts`：`/auth/**` 与 `/security/**` **每条**显式归类（各带理由），默认 fail-open，漏登记 `risk.sensitivity.spec.ts` 红且报 `METHOD path` | `risk.sensitivity.ts:67-70`（families = `AuthRoutes.BASE` + `/security`）、`:75-280`（全量表）、`:344-347`（`isWalnutAdminRiskFailClose`，未登记 = false）；`risk.sensitivity.spec.ts:24-30`（扫描对账，报缺失 `METHOD path`）| ✅ |
| 44 | `security.md:243-246` | CAP 在 `recommendation === undefined` 时同口径分级：敏感 40667、其余放行并 `request.riskDegraded ??= 'risk-recommendation-missing'` | `cap.guard.ts:93-105`（含 `??=`，注释说明「不覆盖更具体的原因」）| ✅ |
| 45 | `security.md:241-242` | `recommendation` 存在时行为不变：cookie 缺失/校验失败 → `shouldChallenge` 为 true 则 40116，否则 40117 | `cap.guard.ts:126-131,149-153` | ✅ |

### 3.3 计数 / 口径（13-B）

| # | 文档位置 | 断言 | 复算方式与结果 | 判定 |
|---|---|---|---|---|
| 46 | `README.md:22`、`release.md:13`、`reference-repo-comparison.md:210` | 15 个 workspace 包；判据 = `pnpm-workspace.yaml` 的 `packages` 字段 | 枚举 5 组 glob：apps 3 + platform-any 3 + platform-web **2** + generated **1** + tooling 6 = **15**；`pnpm-workspace.yaml:72-81` 五条 patterns | ✅ 改成「按目录组五组 + 判据」是对的 |
| 47 | （同上） | **3+3+3+6 也 = 15** 的陷阱 | 3+3+3+6 = 15、3+3+2+1+6 = 15：**加法验不出来**，必须按组枚举 —— 这正是 README 去掉每组个数的理由 | ✅ 陷阱判断成立 |
| 48 | `release.md:13` | 14 → **15** 个包（`versioning.fixed` 组成员 = 有 `version` 的包）| 逐包 `JSON.parse`：15/15 个包都有 `version`（全 `0.1.24`）| ✅ |
| 49 | `reference-repo-comparison.md:210` | `walnut` 字段 12 个（`packages/**` 都在写，三个 app 没有）；`main`+`exports` 并存 **3** 个（contract / utils / api-types）；无 `private` **8** 个 | 逐包解析：walnut = 12（都在 `packages/**`）；main&&exports = `@walnut/contract`/`@walnut/utils`/`@walnut/api-types` = 3；`private !== true` = 8 | ✅ 三个数全对（原文 14/漏 api-types/9 三处都修了）|
| 50 | `README.md:81`、`AGENTS.md:74` | 删掉「7 个包有 test 任务」，改判据式 | 实测有 `test` 脚本的包 = 7（server/contract/utils/client/eslint-config/release/scripts）—— 数字当时是对的，删它是因为属会腐烂计数（`apps/docs/AGENTS.md` 约定 8）| ✅ |
| 51 | `AGENTS.md:71` | `types:check` 注释里删掉幽灵包 `ui` | `apps/ui` 不存在；裸 `ui` 不是 `@walnut/<slug>` 也不是顶层路径 ⇒ `lint:docs-refs` **抓不到**，只能人抓 | ✅ |
| 52 | `review/backend/index.md:397-403`、`libs-decoupling-residuals.md:71-76,136-137` | prepush「全部段未报错（段数以表为准）」+ actionlint 段本机 SKIP、CI 侧权威、不计入全绿 | `packages/tooling/scripts/src/ci/prepush.ts` 里 `id:` 共 **26** 条（实测 grep 计数 26）；`lint-workflows.ts:20-27`（探测失败只 warning + `return`，退出码 0）；`prepush.ts:291-311`（只有抛错才 `ok=false`）、`:324-328`（`ok` 打 ✓）、`:339-341`（汇总「N 段全部通过」）| ✅ 口径正确，26 这个数也对 |
| 53 | `knip.md:199-206,229` | 删掉「82 条」并加「别引用那个数字」+ 代码块标成快照 | `knip.md:95,105-106` 自己写了「两处 barrel 批次 4 已删、utils-core 已收缩」，与新增说明自洽 | ✅ 做法正确（保留结论、去掉会腐烂的数值）|
| 54 | `AGENTS.md`（根）、`apps/server/AGENTS.md` | 预算 96%→**87%**（7579/8700）、97%→**88%**（6038/6900） | `pnpm lint:doc-budget` 实跑：87% 7579/8700 + 88% 6038/6900 | ✅ |
| 55 | `AGENTS.md`、`apps/server/AGENTS.md`（删重复后） | 「规则一条没丢」 | 抽查仍在：`apps/server/AGENTS.md` 保留 5 个部署后不许改的 env key、Guard 12 位顺序、Repository/@Global 判据、DTO 两条、同 worktree 单实例集成测试纪律、ADR 0007/0022/0012 链接；根 `AGENTS.md` 保留 11 条关键纪律 | ✅（删的是同源副本，不是规则）|

---

## 4. 两处自报偏差的裁决

### 4.1 `packages/tooling/release/src/release/steps.ts:405` 的「11 段并行」——**可接受，留到代码批**

- 事实：该行写 `"…11 段并行、每段报耗时…"`；`PREPUSH_GATES` 实测 **26** 段。
- 任务里说的「11 → 12」也不成立（12 同样是旧读数），R2 的判断正确。
- 裁决：**接受不改**。理由：本批验收是「`git diff --stat` 只含 .md」，改 `.ts` 会让本批交付形态自毁验收；而且这行是**源码注释**，不是活文档，
  修它的正确批次是 13-G（prepush 三态/措辞那批）。R2 已在 `r2-docs.md:403` 登记，属**已知且已记账**的偏差。
- 但请 Lead 记一条：**在这行被改掉之前，仓库里「11」与文档里的「26 / 以表为准」是两套说法**，13-G 不能再漏。

### 4.2 `@walnut/ui` 豁免摘不掉 ——**可接受，驳回「本批摘豁免」的可能性**

我自己按门禁的判据复算了一遍：

- 判据在 `packages/tooling/scripts/src/ci/check-doc-refs.ts:409-412`：包名引用**只有**「是真实 workspace 包」或「在 `ALLOWED_MISSING_PACKAGES` 里」两条活路，没有第三种。
- `@walnut/ui` 的豁免在 `:113`。
- 活文档（排除 `content/{archive,industry-research}/`，即 `FROZEN`，见 `:36`）里仍引用 `@walnut/ui` 的 **.md 文件 = 18 篇**：
  `content/adr/{0001,0014,0017,0012}.md`、`content/plans/package-sinking-proposal.md`、`content/monorepo/{architecture,architecture-todo,glossary}.md`、
  `content/frontend/base/plugin.md`、`packages/platform-web/client/README.md`、`apps/admin/CHANGELOG.md`、
  `reports/batch-1/{r1-fe-verification,r2-fe-implementation,r3-fe-review,r3fe-fixup}.md`、`reports/batch-2/r1-verification.md`，
  以及本批两篇 `reports/batch-13/{r1,r2}-docs.md`。
- `content/adr/` 只免**路径**不免**包名**（`:56` 的 `PATH_CHECK_EXCLUDED` 只作用于 `:421` 的路径分支）；`reports/` 同理（`:49-54` 是 2026-11 R3 的明确裁定）。
- 结论：**摘掉豁免立刻红，且只能靠改 ADR 历史叙述或放宽 `reports/` 来兜** —— 两者都比「留一条带理由的豁免」更糟。**维持原状正确。**
- 唯一不精确：R2 说「**17 篇**」（`r2-docs.md:146`），实际现在是 **18 篇**（多了本批两篇报告；门禁那句「包名豁免 17 条」是**豁免表条数**，不是文档数，两者容易混）。
  因为把本批两篇也算进「活文档」正是 R2 自己 §5.1 的推理，所以这个 17 只是**写报告时的快照**，不影响裁决；建议把「17 篇」改成「18 篇（含本批两篇报告）」或直接写判据。

---

## 5. 发现的问题（按严重度）

### 5.1 P0 · 必须修：`shared/device.md:169` 的 mermaid 与同文件 §3 自相矛盾

当前行（图 1，步骤 3）：

```text
Server->>DB: 查到 device_id 即整体覆盖，否则插入<br/>deviceName 只在插入时由服务端生成
```

- 同文件 `device.md:76-78` 写的是「服务端在**每次** initial 里生成 … （不区分新建还是复用）」；
- 源码：`device.service.ts:126` 把 `deviceName` 放进 `deviceData`，`device.basic.repository.ts:46-52` 命中已有行时 `Object.assign(existing, deviceData)` 后 `save` ⇒ **复用路径也会覆盖 deviceName**。
- 严重度理由：这正是 R2 §0 自报「修正了 R1 的错」的那条事实；图比正文更容易被读者记住，留着等于把本批最大纠错点在**同一页**上作废。
- **应改成**（示例）：
  ```text
  Server->>DB: 查到 device_id 即整体覆盖，否则插入<br/>deviceName 每次由服务端重新生成（新建与复用都覆盖）
  ```

### 5.2 P1 · 必须修：`backend/modules/system-account.md:92-93` 的失败侧错误码

当前：

```text
- 并发**同 cookie**（同一台已登记设备）由 `uq_device_id` 决出唯一胜者；失败侧是受控拒绝
  （40605 或 42900 限流），语义见 `concurrency.api-spec.ts` 的 G3。
```

- 它**自己引用的那份 spec** 写的失败侧是 40000：`concurrency.api-spec.ts:245`（用例标题「冲突 40000 / 限流 42900」）、`:284-288`（允许集只有 `SUCCESS` / `BAD_REQUEST`(40000) / `TOO_MANY_REQUESTS`(42900)，且断言无 5xxxx）。
- 代码路径：`device.service.ts:179-186` —— 23505 走 `WalnutAdminExceptionBadRequest`（**40000**），其它异常才 40605。并发撞 `uq_device_id` 属 23505 ⇒ **40000**。
- **应改成**：`（40000 冲突 / 42900 限流，均为受控拒绝）`。
- 说明：旧文档也写 40605，但本批**重写了这句话并新加了 spec 指针**，却没对 spec 的断言 —— 属本批应修未修。

### 5.3 P2 · 建议本批内修：`backend/modules/system-data.md:197` 仍是旧键名

```text
- 设备缓存 `SYS_DEVICE:<deviceId>` 与锁缓存 `SECURITY_LOCK:<userId>:global|deviceId` **没有 TTL**，
```

- 真实键值：`SYS_DEVICE` 是 `WalnutAdminConstAppCacheKeys` 的**成员名**，其值是 `'SYSTEM:DEVICE'`（`const/src/app/cache.ts:34`）；`SECURITY_LOCK` 的值是 `'SECURITY:LOCK'`（`:24`）。
- 本批把另外四篇都改成了 `SYSTEM:DEVICE:`（`security.md:287,293`、`auth.md:51`、`system-account.md:106`、`device.md:172`），唯独这行没改 ⇒ **同一事实在活文档里两个名字**，与 13-B「一处事实一个家」的目标直接冲突。
- 一行改法：`设备缓存 `SYSTEM:DEVICE:<deviceId>` 与锁缓存 `SECURITY:LOCK:<userId>:global|deviceId``。
- 属 .md，改它不破坏验收。若 Lead 认为越界（不在 13-A 点名的 5 篇里），请把它显式登记进下一批，别就这么留着。

### 5.4 P3 · 留到下一批

1. `shared/device.md:129`「四条同时满足」→ 实为 5 组谓词（monitor 行与活 RT 是两条独立 `NOT EXISTS`）。建议「五条」，或写成「四条 ＋ 两个 NOT EXISTS 旁证」。
2. `r2-docs.md:146` 的「17 篇」→ 现在 18 篇（见 §4.2）。
3. `packages/tooling/release/src/release/steps.ts:405`「11 段」→ 26（见 §4.1，13-G）。
4. `apps/server/libs/system/src/device/device-id.ts:20` 的注释「只在两处调用…登录成功时」已过期（生产唯一调用点 `device.service.ts:108`；R2 已登记，13-E）。
5. 机制风险（R2 §7.1 已登记，我确认成立）：`ipHistory` 的 5 写在 DTO `maxSize` 与 `updateIpAndLocation` 两处、**无门禁绑定**；`deviceName` 每次覆盖的语义**无 spec 守着**（`device.service.spec.ts` 现有用例只断言 kicker 调用次数）。

---

## 6. 「建议本批内修」vs「留到下一批」

| 分类 | 条目 | 为什么 |
|---|---|---|
| **必须本批内修**（不修不可提交） | `shared/device.md:169`（deviceName 只在插入时） | 与本批头部纠错点直接矛盾，且是同一个文件内自相矛盾 |
| **必须本批内修** | `backend/modules/system-account.md:92-93`（40605 → 40000） | 本批重写的句子 + 本批新增的 spec 指针自证其错 |
| **建议本批内修** | `backend/modules/system-data.md:197`（`SYS_DEVICE:` → `SYSTEM:DEVICE:`，顺带 `SECURITY_LOCK:` → `SECURITY:LOCK:`） | 一行、纯 md、消灭活文档里的同事实两名 |
| 建议本批内修 | `reports/batch-13/r2-docs.md:146` 的 17 → 18 | 报告里的读数，改一行 |
| 留到下一批 | `steps.ts:405` 的「11 段」（13-G） | 改源码，破本批验收 |
| 留到下一批 | `device-id.ts:20` 注释（13-E） | 同上；且它与「签发点只有一处」是同一批要处理的一族 |
| 留到下一批 | `device.md:129` 的「四条」→「五条」 | 措辞精度，不影响读者判断 |

---

## 7. 复核方法、覆盖面与未覆盖项

- **方法**：先 `git status/diff` 固化改动面 → 逐文件读 diff → 对每条断言回源码取证（`read` 带行号 / `grep` 定位）→ 最后跑门禁。
  门禁全部在本轮工作树上跑（不是抄 R2 的输出），`exit code` 由 `cmd /c "pnpm …"; $LASTEXITCODE` 取。
- **覆盖**：设备身份/自愈/续期/留存/心跳归属/风控分级/CAP/计数口径/字数预算/门禁读数，共 **55 条**（表内 1–55），其中 **2 条判错、1 条判不精确**。
- **未覆盖（明确声明，不假装核过）**：
  1. `device.guard` 与 `cache` 的**竞态**细节（P2-21 的覆盖窗口）—— 文档只做引用，未验证竞态本身；
  2. `meta.riskDegraded` 的**前端消费**（本批只把它写进文档，代码侧无消费方，属新事实的可见性缺口，不是文档错）；
  3. `content/shared/capjs.md` 的「token 本体 20 分钟 / `min(ttl,20min)`」—— 本批没动它（R2 已声明），我**没有**独立复核这条旧断言；
  4. `knowledge`：`reports/batch-*/` 里的旧设备语义（冻结语料，按约束不动）。
- **没做的破坏性动作**：未 stash / checkout / restore / clean / reset / add / commit，未改任何被跟踪文件，未联网，未跑 vitest 全量，未重启服务。
