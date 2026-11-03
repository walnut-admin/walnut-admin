# app 模块族与 shared（demo / error / key / setting / monitor / logger / area / ali）

本篇覆盖三类「非业务主域」的后端代码：`libs/app-domain/` 的应用级模块族（演示、错误通道、密钥、
配置、监控、日志）、`libs/app-domain/shared/` 的共享能力（行政区划、JWT 令牌、阿里云 STS），以及挂在
根路径与 `app/health` 上的基础端点。它们的共同点是**被其他模块消费**，自身不承载业务实体流程。

本文写**当前实现**（PostgreSQL 迁移后）。token / 会话语义见 [认证全链](./auth.md)，
guard 链与方法级权限守卫见 [安全与 guard 链](./security.md)；已知缺陷的登记与裁决见
`apps/server/apps/api/test/api/DESIGN-ISSUES.md`（下文以 `P?-?` 引用）。
表设计依据 `apps/docs/src/zh-CN/content/plans/postgres-migration-phase2.md` 与 `apps/api/migrations/1792922206018-InitSchema.ts`，
站内摘要见 [数据模型与表设计](../schema.md)。

源码入口：`apps/server/libs/app-domain/src/`（批 9 前在 `.../modules/app/` 与 `.../modules/shared/`）与 monitor/user 的 app 侧组合根 `apps/api/src/modules/app/monitor/user/`（wire DTO + controller，swagger schema 顺序约束）、
`.../app/app.controller.ts`、`.../modules/techniques/health/`。
接口矩阵的原始测绘在 `apps/server/apps/api/test/api/ENDPOINTS.md` §1 / §4 / §6 / §7。

## 1. app 族总览

`AppAppModule` 只做装配，六个子模块彼此独立：

| 子模块 | 源码目录 | 职责 | 主表 | 访问门槛 |
|---|---|---|---|---|
| demo | `libs/app-domain/src/demo/` | 标准 CRUD 教学模板，全仓 CRUD 的参照实现 | `app_demo` | 全链 + `app:demo:*` |
| error | `libs/app-domain/src/error/` | 按错误码抛受控异常，联调错误通道 | `app_error`（错误落库由全局过滤器走队列） | DevOnly + root/developer + `app:error:test` |
| key | `libs/app-domain/src/key/` | RSA / AES 密钥的初始化、查询、轮转 | `app_key` | current 仅全链；init / rotate 另需 root |
| setting | `libs/app-domain/src/setting/` | 应用配置的公开面 / 私有面、CRUD、缓存刷新 | `app_setting` | public 五 Free；private LockFree；写路径 `app:setting:*` |
| monitor | `libs/app-domain/src/monitor/` | Redis 缓存管理、服务器指标、在线用户监控与踢人 | 无 / 无 / `app_monitor_user` | 各 controller 自定（见 §1.5） |
| logger | `libs/app-domain/src/logger/` | 读取运行日志文件（分页 / 类型过滤） | 无（文件系统） | admin/developer + `app:logger:*` |

### 1.1 demo：CRUD 装饰器形态的参照实现

`AppDemoController` 本身只写六个方法，路由与 OpenAPI 元数据由 `WalnutCrudDecorators({ title, DTO })`
生成：

| 装饰器 | 生成的路由 | 语义 |
|---|---|---|
| `WalnutAdminDecoratorCreate()` | `POST /app/demo` | 创建 |
| `WalnutAdminDecoratorRead()` | `GET /app/demo/:id` | 按 uuid 读取 |
| `WalnutAdminDecoratorUpdate()` | `PUT /app/demo/:id` | 全量更新（DTO 为 create 的 pick） |
| `WalnutAdminDecoratorDelete()` | `DELETE /app/demo/:id` | 软删（快照进 `sys_deleted`） |
| `WalnutAdminDecoratorDeleteMany()` | `DELETE /app/demo/deleteMany/:ids` | 逗号分隔的批量软删 |
| `WalnutAdminDecoratorList()` | `POST /app/demo/list` | `{ query, sort, page }` 列表 |

每个方法另挂自己的 `@WalnutAdminDecoratorHasPermission`（`app:demo:create` / `read` / `update` /
`delete` / `list`；deleteMany 复用 `delete`）。写操作的事务边界不在装饰器里，而由 controller
决定：delete / deleteMany 挂 `@WalnutTx()` 并把 `ctx.em` 传给 service；create / update 是单行
写入，没有事务装饰器。这一点与 `system/user` 的「主行 + junction 多语句」不同——demo 没有
从属表，单语句本身即原子。

作为模板，demo 展示了后续迁移批次沿用的四件事：

1. **实体即 POJO**：controller 统一 `plainToInstance(ResponseDTO, entity)`，不再 `.toObject()`；
2. **uuid 参数管道**：路由参数走 `WalnutAdminDecoratorParamUuid` / `ParamUuids`；
3. **软删语义**：`deleteSoftById` / `deleteSoftByIdMany` 由 PG 基类提供，快照写 `sys_deleted`；
4. **DTO 与列型对齐**：`app_demo` 的数组列是 `NOT NULL` 且无 DB 默认，create / update 的 pick
   因此显式包含全部 6 个数组字段（A 段试点曾因漏 pick 导致 HTTP create 必撞 NOT NULL，已修）。

`app_demo` 的 17 列本身就是「Mongo 各种字段形态落到 PG 的样例」：`text[]` / `integer[]` /
`boolean[]` / `timestamptz[]` / `smallint[]` / `uuid[]`、`jsonb`（`demo_object`）、枚举 CHECK
（`demo_enum IN (1,2,3,4)`）、两个唯一列（`demo_string` / `demo_phone_number`）。DTO 侧的
`demoString` 有 `IsUppercase`、`demoStringArray` 有 `IsLowercase` + `contains('1')`，list 的字符串
过滤是 ILIKE 子串（`%` / `_` 按字面量转义），出参侧 `demoString` 会被折成小写。这些是刻意保留的
校验/变换演示，不是业务规则。

### 1.2 error：错误通道测试端点

`GET /app/error/:code` 用 `WalnutAdminPipeParamEnum(WalnutAdminConstAppResponseCode)` 限定错误码，
在 `ErrorMap` 中取对应异常类并抛出。它的作用是让前端/联调按错误码验证统一响应壳，不产生业务数据。

- 类级：`@WalnutAdminDecoratorHasRole([root, developer], OR)` + `@WalnutAdminDecoratorHasPermission('app:error:test')`；
- 方法级：`@WalnutAdminDecoratorDevOnly()` —— 生产环境不可用；
- `ErrorMap` 覆盖 contract 的全部响应码（P2-7 已把 40112–40117 与各 guard 的真实抛码逐项对齐）；
  枚举外的 code 由管道拒绝为 **40099**，不会走到 `new ErrorMap[code]`。

全局异常过滤器对错误码有白名单：只有 `40000` / `40099` / `50000` / `50001` 会经 Bull 队列写入
`app_error`，并且 `addErrorQueue` 对 `/` 与 `app/error` 路径做跳过判断。因此这个端点主要验证
「异常 → 统一响应壳」与 `app_error` 的落库链路，而不是压力测试入口。

### 1.3 key：RSA / AES 密钥的初始化与轮转

`app_key` 是配置级小表（个位数到数十行），`meta` 是 jsonb：RSA 存 PEM 对，AES 存 `keyB64`，
不同 `type` 的形态完全不同。`type` 取值 `RSA_PAIR` / `AES_KEY_URL` / `JWT_AT` / `JWT_RT`，
`status` 取值 `ACTIVE` / `DEPRECATED` / `DISABLED`，两者都有 CHECK。

| 端点 | 行为 |
|---|---|
| `GET /app/key/current/:type` | 取该 type 中 `status='ACTIVE'` 且 `version` 最大的一行，返回其**公开面**投影：`RSA_PAIR → { publicKeyPem }`、`AES_KEY_URL → { keyB64 }`（P0-6：私钥永不出 HTTP，内部解密走实体通道） |
| `POST /app/key/init` | 该 type 没有任何行时创建 v1；任一行存在 → 40001 DataExists |
| `POST /app/key/rotate/:type` | 事务内锁当前 ACTIVE 行 → 置 `DEPRECATED` → 插入 `version+1` 的 ACTIVE 行 |

init / rotate 挂 `@WalnutAdminDecoratorHasRole(Role.ROOT)`；rotate 还挂 `@WalnutTx()`，
`getCurrentActiveKey(type, em, true)` 在事务内 `FOR UPDATE`（P1-1 修复：两路并发 rotate 不再
产生两条同 version 的 ACTIVE，败者在锁释放后读不到 ACTIVE → 受控 40401）。新 key 的
`validStart=now`、`validEnd=now+30 天`，RSA 为 2048 位 spki/pkcs8 PEM，AES 为 32 字节随机
`keyB64`。

**cron 到期轮转**：`AppTechTasksService.rotateAppKey` 每天零点分别对 `RSA_PAIR` 与
`AES_KEY_URL` 调 `rotateForCronJob` —— 只有当前 ACTIVE 行的 `validEnd` 已过期才在程序化事务里
执行同一套 rotate；HTTP 的 rotate 不检查 `validEnd`，随时可手动轮转。

**线上语义（重要）**：

- `SecurityRsaService.getCurrentRsaPrivateKey()` 只读当前 ACTIVE 行。`rotate` 把旧行置
  `DEPRECATED` 后，用旧公钥加密的请求密文（`@WalnutAdminDecoratorDecryptRequest` 的请求拦截器）
  将无法用新私钥解开，直接 40011。当前没有「重叠窗口 / 按 version 回退解密」的机制（P2-30）。
- `getCurrentActiveKey` 只按 `type + status=ACTIVE + version DESC` 取行，**不校验 `validEnd`**：
  过期但尚未轮转的 key 仍是「当前 key」，直到 cron 下一次执行或手动 rotate。
- `GET /app/key/current/:type`（P0-6 已修，2026-10-28）：`RSA_PAIR` 视图挂 `app:key:read`
  （`AppKeyCurrentGuard`，root 短路），`AES_KEY_URL` 视图保持登录可读（admin URL 掩码的客户端
  分发密钥）。响应经 `plainToInstance(AppKeyDTOSafe)` + service 侧显式剔除，**永不包含
  `privateKeyPem`** —— 只下发 `publicKeyPem` / `keyB64` 公开面。
- `JWT_AT` / `JWT_RT` 只存在于枚举与 CHECK：DTO 层拒绝 `init JWT_AT`（P2-6，40099），注释称
  「系统启动自举」，但全仓没有生产写入点，JWT 签名实际使用 env 的 `jwt.*.secret`（P3-27）。

### 1.4 setting：public / private 双面与缓存刷新链

`app_setting` 的 9 列：`setting_name`、`setting_key`（唯一）、`setting_value`（text，存 JSON 文本）、
`setting_type`（`auth` / `global` / `functional`，CHECK）、`remark`、`created_by`（松引用）与公共列。
配置值是 JSON 字符串，读取侧统一 `JSON.parse` + 缺省值兜底。

**两个只读面**：

| 端点 | 守卫 | 形状 |
|---|---|---|
| `GET /app/setting/public` | Lock / Sign / JWT / CAP / Device 全 Free | `{ auth: { email, phone, qrcode, gitee, github, google, opaque { enable, register, forget } }, frontend: { fullScreen, search, dark, locale } }`，全部布尔 |
| `GET /app/setting/private` | LockFree（JWT 仍生效） | `{ maskUrl, hijackRefresh, watermark, transition }`，每项 `{ status, mode, value }`（mode 取自配置的 `scope`，value 取自 `globalValue`） |

public 面的布尔来自 `+value === 1`；配置键缺失时走 `AppTechCacheAppSettingsService` 的默认值
（例如 cap 默认 `count=10 / size=16 / difficulty=4 / ttl=1h / throttleLimit=4 / throttleTtl=60`，
opaque 默认全 0，frontend 全 0）。

**写面**：`POST /app/setting`、`GET /app/setting/:id`、`PUT /app/setting/:id`、
`POST /app/setting/list`、`POST /app/setting/cache/refresh`。**没有 delete / deleteMany**（P3-26）：
`AppSettingController` 未挂 `WalnutAdminDecoratorDelete`，配置行只能新增/修改，删除需改库。

缓存刷新链：

```text
create / update
  -> AppSettingService 调 extractAppSettingIntoCache()
  -> 全表 find() 组装 { settingKey: settingValue }
  -> cache.set('APP:SETTING', map, { t: BUILT_IN })
  -> setAppSettings() 清空进程内 memo（appSettingsMemo / settingMemo）
  -> 响应返回时缓存已是新值

POST /app/setting/cache/refresh
  -> 同一个 extractAppSettingIntoCache()（手动作业面）

updateAppSettingByKey(key, value)
  -> 行存在才 save（缺行静默 no-op，P2-15）
  -> runAfterCommit(extractAppSettingIntoCache())：事务内推迟到提交后，事务外就地执行

AppTechTasksService.extractAppSetting
  -> 每天 02:00 定时全量重算
  -> 启动期 bootstrap 也会跑一遍（W2-A 起在 AppBootstrapTaskModule，默认归 api）
```

覆盖面要按「谁写库」判断：

| 写入路径 | 是否刷新 `APP:SETTING` |
|---|---|
| setting create / update | 是（同步，响应前完成） |
| `updateAppSettingByKey`（IP 永久黑名单等内部消费方） | 是（after-commit；缺行时什么都没写） |
| `POST /app/setting/cache/refresh` | 是 |
| cron 02:00 / 启动预热 | 是 |
| 直接 SQL / `db:seed:pg` / ETL 写 `app_setting` | **否**，直到下一次刷新（进程内 memo 也不会失效） |

进程内 memo 是 L3 优化：`getAppSettings()` 命中后不再每次 Redis GET，`getSetting()` 命中后不再
重复 JSON.parse。失效点只有 `setAppSettings`（所有缓存写路径收口）与监控台按 key 删缓存的
防御性失效。多实例部署下其他实例的写不会失效本进程 memo，当前依赖单实例假设（P2-27）。

### 1.5 monitor：缓存 / 服务器指标 / 在线用户

monitor 由三个互不依赖的子 controller 组成。

#### 1.5.1 cache（Redis 键管理）

类级 `@WalnutAdminDecoratorHasRole([root, developer], OR)`，权限点
`app:monitor:cache:{list,read,delete,clear}`。

| 端点 | 行为 |
|---|---|
| `POST /app/monitor/cache/list` | 扫描全部缓存键，在内存里组装 `{ key, valueBytes, expire, type, startTime, expireTime }` 后排序/过滤/分页；`key` 是去掉 `WALNUT_CACHE_` 前缀的展示形态 |
| `GET /app/monitor/cache/:key` | 返回 `{ value: <真实值> }`；键缺失时 `value = null`（P2-4 已修，原先 `void await` 导致恒 `{}`） |
| `DELETE /app/monitor/cache/:key` | **fire-and-forget**：响应先于 Redis DEL，`data` 恒为空；确认删除须再 `GET` 一次（P2-4 契约） |
| `DELETE /app/monitor/cache/clear` | 清空非保护类型；`BUILT_IN` / `AUTH` / `SYSTEM` 三类保留（所以 `APP:SETTING`、认证会话键不会被误清） |

`key` 走 `WalnutAdminPipeCacheKey`：只接受「不含前缀」的字母数字 + `:_.-`、≤128 字符。service
内部再补前缀，因此 list 的展示 key 可以直接喂给 read / delete。clear 的 `:key` 路由必须定义在
`:key` 删除路由之前（Nest 按声明顺序匹配），源码注释已写明。

#### 1.5.2 server（宿主机指标）

八个只读端点：`GET /app/monitor/server/{cpu,mem,os,sys,disk,battery,time,network}`，每个对应一个
`app:monitor:server:<name>` 权限点，类级 root/developer。实现直接调 `systeminformation`：
`cpu()` / `mem()` / `osInfo()` / `system()` / `diskLayout()` / `battery()` / `time()` /
`networkInterfaces()`；`disk` 返回数组，`network` 取 `default` 网卡并去掉 `speed` / `default` 键，
`mem` 出参经 `@TransformSizeToGB` 变成 `x.xx GB` 字符串。

**性能面**：每个端点各自独立执行一次 `systeminformation` 探测，没有缓存、没有合并、没有独立
限流。管理台的监控页若轮询八个端点，宿主机命令（尤其 `diskLayout` / `networkInterfaces`）
会被重复执行；当前实现把这个成本交给调用频率控制（P3-29）。

#### 1.5.3 user（在线用户与 force-quit）

`app_monitor_user` 10 列：`visitor_id`（唯一）、`user_id` / `device_id`（松引用、无 FK）、`auth`、
`focus`、`is_left`（保留字 `left` 的列名）、`current_router`、`first_visit_at` / `last_active_at`。
没有 `created_at` / `updated_at`。

**行键是 `device_id`**（`idx_monitor_device`）—— 服务端从签名 cookie 解析的那个值；`visitor_id` 的
唯一约束只保证「一个指纹只落一行」，它**不是**行键（批次 8 / B6 起）。

| 端点 | 守卫 / 权限 | 行为 |
|---|---|---|
| `POST /app/monitor/user/list` | 全链 + `app:monitor:user:list` | JOIN 版列表，支持 device/user 字段过滤；排序白名单 `firstVisitAt` / `lastActiveAt` |
| `GET /app/monitor/user/:id` | 全链 + `app:monitor:user:read` | 行 + 按 `device_id` / `user_id` 装回 device / user 简要对象 |
| `POST /app/monitor/user/state` | Sign / JWT / CAP / Device 全 Free；Lock 等其余守卫仍生效 | 匿名上报：**行键 = 服务端从签名 cookie 解析的 deviceId**；body 的 `visitorId` 只作归属校验（与本设备已存行比，不一致 40099 且**不写库**，首写登记）；联动 `sys_user_device.last_active_at` 与设备 active 状态 |
| `DELETE /app/monitor/user/force-quit/:id` | 全链 + `app:monitor:user:forceQuit` + `@WalnutTx()` | 按 monitor 行 id 找 `(userId, deviceId)`，走 `AuthSignoutService.doSignout(trigger='admin-kick')` |

`state` 的语义细节：`auth === false` 时 `updateState` 在按 nil 过滤构造 payload 之后**显式**
补 `userId: null`（P2-31 已修，2026-10-29）—— 已存在的行会被清空 `user_id`，在线监控不再
残留上次登录用户；新插入的行同样落 null。02:00 的 `updateAuthStateForCronJob` 仍负责按
过期 RT 做同样的清零（幂等兜底）。

force-quit 撤该 `(userId, deviceId)` 的全部 RT（P1-9 已修为全量撤销）并向在线设备发
`FORCE_QUIT` socket 事件；P2-12 修复后（2026-10-28）事务提交后还按设备清
`AUTH:SESSIONS` / `AUTH:PERMISSIONS` / `AUTH:MFA:VERIFIED` 三键 —— 配合 JWT validate 的
会话键校验，被踢设备的旧 AT 立即 40101。monitor 行不存在时返回 `false`（不是 404）；
非法 uuid 由参数管道拒绝 40002。

列表默认排序是 `lastActiveAt`（admin 列表），但 `app_monitor_user` 的索引只有
`uq_monitor_visitor` / `idx_monitor_device` / `idx_monitor_user`，没有 `last_active_at` 索引
（P3-30）；行数随访客增长，量级大后默认排序会走内存 Sort。

### 1.6 logger：文件日志读取

类级 admin/developer（OR），权限点 `app:logger:list` / `app:logger:read`。

- `POST /app/logger/list`：以 `process.cwd()` 为根，`glob('**/*.log', '**/*.log.gz')` 扫描
  `logs/`（或 `logs/application` / `logs/error`，由 query 的 `logType` 决定）；`fileName` 做
  不区分大小写的子串过滤，结果按文件修改时间倒序分页。`fileSize` 出参是 `x.xx KB` 字符串
  （`@TransformSizeToKB`）。
- `GET /app/logger/:logType/:fileName?page=`：`logType` 枚举闸（`application` / `error`）+ fileName
  白名单正则（首字符字母数字、禁路径分隔符、`.log` / `.log.gz` 结尾）；service 侧再
  `path.resolve` 断言目标仍在 `logs/` 内（纵深第二道）。每页固定 30 行，支持 `.gz` 流式解压；
  文件不存在时 ENOENT 被全局过滤器兜底为受控 50000。

因为根目录是 `process.cwd()`，后端必须从 `apps/server/` 启动才能读到 `apps/server/logs/`。
list 行与 read 响应都没有 `id` 字段（P3-14），前端以 `filePath` 作 rowKey。

## 2. shared

`SharedModule`（app 的聚合根）装配 `token`、`ali`、`area`、ALS request、delay、BLPath、ip、mask
等能力；批 9 起 `ali` / `area` / `mask` 的数据面在 `@walnut-server/app-domain/shared`，其余能力
本来就在各自 lib。本篇只写有 HTTP 面或有跨模块契约的三块。

### 2.1 area：区划树的层级缓存与递归 CTE

`shared_area` 只有 4 列（`id` / `code` / `name` / `pcode`），无时间列、无 FK；`code` / `pcode` 是
`varchar(12)`，`code` 唯一，`pcode` 有 B-tree 索引。存量约 66.3 万行，code 长度分布 2/4/6/9/12
（12 位村级占绝大多数）；顶层省份的 `pcode='0'` 是约定根值，不对应任何行。

| 端点 | 权限 | 行为 |
|---|---|---|
| `GET /shared/area/children?pcode=` | `app:shared:area:children:list` | 查一层子节点（`pcode` 必填，`WalnutAdminPipeAreaPcode` 只收 1–12 位数字） |
| `GET /shared/area/feedback?codes=` | `app:shared:area:feedback:list` | 按一个或多个 code 回显「祖先链 + 同级兄弟」组成的树，节点带 `depth` / `isLeaf` |

**日常路径是单层查询 + 层级缓存**，不是每请求建整树：

- `getChildrenByPcodeWithCache(pcode)`：按 pcode 长度选缓存键（`SHARED:AREA:PROVINCE` /
  `CITY` / `DISTRICT` / `STREET` / `VILLAGE`），缓存里已有该 pcode 的行就直接过滤返回；
  未命中时进 `murlock` 分布式锁（3000ms），锁内二次检查缓存，再查
  `findChildrenByPcode`（`WHERE pcode=$1 ORDER BY code`，走 `idx_area_pcode`），把结果
  **追加**到该层级的数组后写回 `SHARED` 类型缓存。
- 缓存粒度是「层级」而不是「父节点」：同一层级的多个父节点的子节点都堆在同一个键里，
  命中判断靠 `some(i => i.pcode === pcode)`。层级缓存会随访问面扩大而增长，换来的是跨父节点
  复用时无需重复查库。
- `feedback` 从目标 code 向上逐级取同级兄弟，反转后 `arrToTree`；`depth` 由 code 长度映射
  （2→0、4→1、6→2、9→3、12→4），`isLeaf` 以**本次返回数据的最深层**为准（同级节点一致），
  不是「数据库里有没有子节点」。`feedbackMultiple` 逐 code 取树、按 code 去重合并后再建树。

**递归 CTE 能力**：repo 提供 `findSubtreeByCode(code, { maxDepth })` ——
`WITH RECURSIVE ... CYCLE code SET is_cycle USING path`，锚点走 `uq_area_code`，递归项每层走
`idx_area_pcode`；`assembleSubtree` 把平铺行组装成 `children` 树，成环组件按首见提升为根并剪掉
回边，保证输出可序列化。它对应 phase2 §5.1 的「整树 / 限深」设计，但**当前没有端点或业务调用方**
（P3-28）：area 只有 children / feedback 两个单层接口。

冷路径曾有一个迁移回归：`findChildrenByPcode` 返回 TypeORM 实体实例，被全局
`ClassSerializerInterceptor`（`excludeExtraneousValues: true`）剥成 `[{}]`；现已投影为普通
`{ name, code, pcode }` 对象，与 Mongo `.lean()` 对齐（B 段 API 回归抓出并修复）。

### 2.2 token：JWT 的签发与载荷组装

`AppTokenService`（`@walnut-server/token`）是 AT / RT 的唯一签发点，不提供 HTTP 端点：

- `generateJwtAccessToken(payload)`：HS256，secret = `jwt.access.secret`，有效期
  `jwt.access.expire` 秒；
- `generateJwtRefreshToken(jti, sid)`：只含 `{ jti, sid }`，secret = `jwt.refresh.secret`；
- `generateJTI()`：nanoid 24；
- `getJwtAccessTokenPayload(user, { isTrusted })`：从 `sys_user` 行 + junction 组装的
  `roles_list` 产出 `userId` / `userName` / `roleIds` / `roleNames` / `currentRole` /
  `currentRoleName` / `roleMode` / `mfaSetup` / `mfaVerified`（= 设备 `trusted`）；
- `decodeAccessToken(token)`：仅解码，不验签。

`sid` 由调用方（登录 / 刷新链）生成并同时写会话缓存，详见 [认证全链](./auth.md) §3.1。
**加密信封不属于这个模块**：`@WalnutAdminDecoratorEncryptResponse` 是
`decorators/walnut/crypto.decorator.ts` 的响应拦截器，用「一次性 AES-256-GCM 密钥 + IV + tag
拼 60 字节 blob，再用**客户端**在上报的 RSA 公钥加密该 blob」；`/security/sign/aes-key`、
`/auth/keys`、`/shared/ali/sts` 都用同一格式。请求方向的对应物是
`@WalnutAdminDecoratorDecryptRequest`，用**服务端**当前 RSA 私钥解密（与 key 轮转的兼容性
问题见 §1.3 / P2-30）。

### 2.3 ali：外部依赖边界

`GET /shared/ali/sts`（权限 `app:shared:ali:sts`，全链）向阿里云 STS 发 `AssumeRole`：

- 凭证与目标来自 env `vendor.ali.OSS`（`id` / `secret` / `endPoint` / `roleArn` /
  `roleSessionName` / `region` / `bucket`）；`@alicloud/sts20150401` + `@alicloud/openapi-client`；
- 访客角色（`currentRoleName === visitor`）额外带只读 policy：`oss:GetObject` +
  `oss:ListObjects`，`Resource: '*'`；其余角色用 role 自身的权限；
- 响应只保留 `accessKeyId` / `accessKeySecret` / `stsToken` / `region` / `bucket`，前三个经
  `@WalnutAdminDecoratorEncryptResponse` 用客户端 RSA 信封加密；
- **外部依赖边界**：env 配了 key 就会发真实外网请求，结果取决于阿里云凭证有效性与网络；
  SDK 异常没有映射成受控业务码，未命中时由全局兜底成 50000（P3-6）。API 回归只断言
  「20000 信封形状 XOR 50000 兜底」两态。

## 3. 根端点

`src/app/app.controller.ts` 的类级只有 `@WalnutAdminGuardDeviceFree()`，三个方法共享：

| 端点 | 额外守卫 | 返回 |
|---|---|---|
| `GET /` | `@WalnutAdminGuardJwtFree()` | i18n `index.hello`（含当前 `lang`） |
| `GET /auth` | 无（JWT 生效） | i18n `index.hello.user` |
| `GET /deps` | 无（JWT 生效） | `package.json` 的 `dependencies` / `devDependencies` |

`/` 虽然 JWT Free，但 Sign 守卫仍生效（单因子），缺签名头 → 40112；`/auth` 与 `/deps` 匿名
调用 → 40101。**`/deps` 不是依赖健康检查**：它返回的是 package.json 的依赖清单，与 PG / Redis
连通性无关（ENDPOINTS §7 的勘误）。`/auth` 与 `/deps` 没有 `@HasPermission`，任何已登录用户
（含 visitor）可读；`/deps` 的依赖清单属于信息暴露面，当前未加角色限制。

## 4. health

`GET /app/health/{network,postgres,memory-heap,memory-rss,disk}`，类级 root/developer（OR），
权限点 `app:health:<name>`。五个端点直接调用 terminus 的 indicator，不经过
`HealthCheckService.check`，因此**没有** `{ status, info, details, error }` 外壳，响应 `data`
就是 indicator 本身（例如 `{ status: 'up', ... }`）。

| 端点 | 判据 |
|---|---|
| `network` | `HttpHealthIndicator.pingCheck('baidu', 'https://www.baidu.com')`，外网依赖，不进回归 |
| `postgres` | `TypeOrmHealthIndicator.pingCheck`，显式传 `WalnutPGConnectionName` 的 DataSource —— **迁移回归哨兵**（B 段用它直接验证连接可用） |
| `memory-heap` | `checkHeap`，阈值 200 MB |
| `memory-rss` | `checkRSS`，阈值 200 MB |
| `disk` | `checkStorage`，阈值 75%，路径硬编码 `C:/`（P3-22：Linux / 容器没有 `C:/`，会抛错并被兜底成 50000） |

terminus 在本仓不抛 503：超阈时返回 `status: 'down'`，HTTP 仍是 200 + 统一响应壳；只有
indicator 自身抛异常（如 `disk` 路径不存在）才走全局兜底 50000。

## 5. 接口表

统一响应壳 HTTP 200 + `body.code`（成功 20000）。「守卫链」只写与默认全链不同的 Free /
附加 guard；未列出的全局守卫照常执行。

### 5.1 app 族

| 方法 / 路径 | 守卫链 | 权限点 | 请求 → 响应 |
|---|---|---|---|
| POST `/app/demo` | 全链 | `app:demo:create` | 14 字段 pick → demo 行 |
| GET `/app/demo/:id` | 全链 | `app:demo:read` | uuid → demo 行 |
| PUT `/app/demo/:id` | 全链 | `app:demo:update` | 14 字段 pick → demo 行 |
| DELETE `/app/demo/:id` | 全链 + `@WalnutTx()` | `app:demo:delete` | uuid → 快照行 |
| DELETE `/app/demo/deleteMany/:ids` | 全链 + `@WalnutTx()` | `app:demo:delete` | 逗号 uuid → 快照行数组 |
| POST `/app/demo/list` | 全链 | `app:demo:list` | list DTO → 行数组 + total |
| GET `/app/error/:code` | DevOnly + 类级 root/developer（OR） | `app:error:test` | 枚举 code → 抛对应异常；枚举外 40099 |
| GET `/app/key/current/:type` | 全链 | RSA_PAIR: `app:key:read`；AES_KEY_URL: 登录即可读 | type 枚举 → 公开面（`{ publicKeyPem }` / `{ keyB64 }`，P0-6 私钥永不下发） |
| POST `/app/key/init` | 全链 + root 角色 | 无 | `{ type }` → 新 key 行；已存在 40001；JWT_AT 40099 |
| POST `/app/key/rotate/:type` | 全链 + root 角色 + `@WalnutTx()` | 无 | type 枚举 → 新 ACTIVE key 行 |
| POST `/app/logger/list` | 全链 + 类级 admin/developer（OR） | `app:logger:list` | `{ query: { fileName, logType }, page }` → 文件行 + total |
| GET `/app/logger/:logType/:fileName?page=` | 同左 | `app:logger:read` | 枚举 + 文件名白名单 → `{ fileName, filePath, fileContent: string[] }`（30 行/页） |
| GET `/app/setting/public` | Lock/Sign/JWT/CAP/Device 全 Free | 无 | — → `{ auth, frontend }` 布尔面 |
| GET `/app/setting/private` | LockFree | 无 | — → `{ maskUrl, hijackRefresh, watermark, transition }` |
| POST `/app/setting` | 全链 | `app:setting:create` | `{ settingKey, settingName, settingValue, settingType, remark? }` → 行；刷新 APP:SETTING |
| GET `/app/setting/:id` | 全链 | `app:setting:read` | uuid → 行 |
| PUT `/app/setting/:id` | 全链 | `app:setting:update` | 同 create → 行；刷新 APP:SETTING |
| POST `/app/setting/list` | 全链 | `app:setting:list` | list DTO → 行 + total |
| POST `/app/setting/cache/refresh` | 全链 | `app:setting:cache:refresh` | — → `true`；全量重算 APP:SETTING |

### 5.2 monitor

| 方法 / 路径 | 守卫链 | 权限点 | 请求 → 响应 |
|---|---|---|---|
| POST `/app/monitor/cache/list` | 全链 + root 角色/developer（OR） | `app:monitor:cache:list` | list DTO → 缓存行 + total |
| GET `/app/monitor/cache/:key` | 同左 | `app:monitor:cache:read` | 展示 key → `{ value }`（缺失 null） |
| DELETE `/app/monitor/cache/:key` | 同左 | `app:monitor:cache:delete` | key → 空 data（fire-and-forget） |
| DELETE `/app/monitor/cache/clear` | 同左 | `app:monitor:cache:clear` | — → `true`（无键可删时 `false`；保留 BUILT_IN/AUTH/SYSTEM） |
| GET `/app/monitor/server/cpu` | 全链 + root 角色/developer（OR） | `app:monitor:server:cpu` | — → CPU 指标 |
| GET `/app/monitor/server/mem` | 同左 | `app:monitor:server:memory` | — → 内存指标（`x.xx GB`） |
| GET `/app/monitor/server/os` | 同左 | `app:monitor:server:os` | — → OS 指标 |
| GET `/app/monitor/server/sys` | 同左 | `app:monitor:server:system` | — → 系统指标 |
| GET `/app/monitor/server/disk` | 同左 | `app:monitor:server:disk` | — → 磁盘数组 |
| GET `/app/monitor/server/battery` | 同左 | `app:monitor:server:battery` | — → 电池指标（无电池可空） |
| GET `/app/monitor/server/time` | 同左 | `app:monitor:server:time` | — → 时间指标 |
| GET `/app/monitor/server/network` | 同左 | `app:monitor:server:network` | — → 默认网卡指标 |
| POST `/app/monitor/user/list` | 全链 | `app:monitor:user:list` | list DTO → 行 + total |
| GET `/app/monitor/user/:id` | 全链 | `app:monitor:user:read` | uuid → 行 + device/user |
| POST `/app/monitor/user/state` | Sign/JWT/CAP/Device 全 Free | 无 | `{ visitorId, userId?, auth, focus, left, currentRouter? }` → `true/false`；body 带 `deviceId` ⇒ 40099（行键取 cookie，`userId` 取验签 AT，body 里那两个字段不作数） |
| DELETE `/app/monitor/user/force-quit/:id` | 全链 + `@WalnutTx()` | `app:monitor:user:forceQuit` | uuid → 撤 RT + socket 通知 |

### 5.3 shared / 根 / health

| 方法 / 路径 | 守卫链 | 权限点 | 请求 → 响应 |
|---|---|---|---|
| GET `/shared/area/children` | 全链 | `app:shared:area:children:list` | `?pcode=` → 子节点行数组 |
| GET `/shared/area/feedback` | 全链 | `app:shared:area:feedback:list` | `?codes=a,b` → 树（`depth` / `isLeaf`） |
| GET `/shared/ali/sts` | 全链 | `app:shared:ali:sts` | — → STS 凭证（三敏感字段加密） |
| GET `/` | DeviceFree + JwtFree（Sign 仍生效） | 无 | — → i18n hello |
| GET `/auth` | 类级 DeviceFree | 无 | — → i18n hello.user（JWT 必填） |
| GET `/deps` | 类级 DeviceFree | 无 | — → package.json 依赖清单（JWT 必填） |
| GET `/app/health/network` | 全链 + root 角色/developer（OR） | `app:health:network` | — → indicator（外连 baidu） |
| GET `/app/health/postgres` | 同左 | `app:health:postgres` | — → indicator（迁移哨兵） |
| GET `/app/health/memory-heap` | 同左 | `app:health:memory-heap` | — → indicator（200 MB） |
| GET `/app/health/memory-rss` | 同左 | `app:health:memory-rss` | — → indicator（200 MB） |
| GET `/app/health/disk` | 同左 | `app:health:disk` | — → indicator（75%，`C:/`，P3-22） |

## 6. 已知行为注记

以下均已在 `apps/server/apps/api/test/api/DESIGN-ISSUES.md` 登记，这里只写与本篇相关的现状与指向。

- **P0-6（D 段新登记）**：`GET /app/key/current/:type` 无角色/权限点，任何已登录用户可读取
  `RSA_PAIR.privateKeyPem` 与 `AES_KEY_URL.keyB64`。`key.api-spec.ts` 已断言私钥出现在响应里；
  该端点不是「公开公钥」，与 `GET /security/rsa/public-key` 的定位不同。
- **P2-30（D 段新登记）**：key 轮转没有重叠窗口与旧密文回退。`rotate` 把旧行置 DEPRECATED 后，
  `DecryptRequest` 只能拿当前 ACTIVE 私钥解密；轮转瞬间在途的旧公钥密文 40011。同时
  `getCurrentActiveKey` 不校验 `validEnd`，过期未轮转的 key 仍被当作当前 key。
- **P2-31（已修复，2026-10-29）**：`POST /app/monitor/user/state` 的 `auth=false` 清零改在
  nil 过滤之后显式写入 `userId: null`，已存在的行即时清空 `user_id`。
- **P2-4（已修复）**：monitor/cache read 已 `await` 真实值（缺失键 null）；delete 仍是
  fire-and-forget，响应先于 DEL，契约写在 controller 注释与 spec 里。
- **P2-6（已修复）**：`POST /app/key/init` 的 `JWT_AT` 在 DTO 层被 40099 拒绝，不再假成功。
- **P3-1（裁决接受）**：throttle 超限是 HTTP 200 + `body.code = 42900`（统一响应壳），不是原生
  429；`device/initial` 等被 throttle 包装的端点都按此形态消费，前端按 `body.code` 分支。
- **P3-2（已修复）**：`sys_device.device_name` 重名（23505）已从误导性的 40605 收敛为受控 40000；
  设备登记是 app 族所有签名请求的入口，这条规则影响整条链。
- **P3-6（裁决登记）**：`/shared/ali/sts` 在 env 配了 key 时发真实外网请求，测试只断言受控两态；
  STS 客户端注入化延后。
- **P3-14（read schema 已补，2026-10-29；余 list 行 id 观察）**：logger / monitor-cache 的
  list 行没有 `id`（前端以 `filePath` / `key` 作 rowKey）；两个 read 端点已补专用响应
  DTO（`AppLoggerReadResponseDTO` / `AppMonitorCacheReadResponseDTO`）。
- **P3-22（已修复 2026-10-29）**：health/disk 的检查路径改按平台取根（Windows `C:/`、
  类 Unix `/`），Linux/容器部署不再恒失败。
- **P3-26（裁决 2026-10-29：配置不删）**：setting 没有 delete / deleteMany 端点，配置行只能
  新增/修改；直接改库也不会触发 `APP:SETTING` 刷新。前端契约已写入
  `apps/admin/src/api/types/frontend-shapes.ts`（不提供删除入口）。
- **P3-27（D 段新登记）**：`JWT_AT` / `JWT_RT` 只有枚举与 CHECK，没有生产写入点；DTO 注释所称
  「系统启动自举」在代码中不存在，JWT 实际用 env secret。
- **P3-28（D 段新登记）**：`shared_area` 的递归 CTE（`findSubtreeByCode` / `assembleSubtree`）
  没有端点或调用方，area 实际只有 children / feedback 两个单层接口。
- **P3-29（D 段新登记）**：monitor/server 八个端点各自执行一次 `systeminformation` 探测，无缓存、
  无合并、无独立限流；监控页轮询会重复触发宿主机命令。
- **P3-30（D 段新登记）**：`app_monitor_user` 列表默认排序 `lastActiveAt`，但该列没有索引；
  行数随访客增长，默认排序会走内存 Sort。
