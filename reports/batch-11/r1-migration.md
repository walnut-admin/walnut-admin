# 批次 11 · B5 收尾 —— R1 深度调研（迁移与留存）

- 调研对象：HEAD `9a7f860d`（B5 第 2 步）+ `74077920`（第 1 步），工作树 clean
- 性质：**只读调研**（未改任何源码；本文件是唯一新增物）
- 实测口径：dev 库 = `apps/server/env-local/.env.development` 的 `DATABASE_PG_*`，PG/Redis 通；观察口径 HTTP 恒 200、看 `body.code`
- 结论一律带 `path:line` 或命令输出；没有实测支撑的地方都标了「未实测 / 读码推演」

---

## 0. 结论速览

1. **M2 的 `ON UPDATE CASCADE` 不需要，而且有害**（§1.4，3 条实测）。硬切路径下 `device_id` 从不被 UPDATE —— 全仓 `git grep` 证据 + PG 行为实测。
2. **硬切后真正需要的 DDL 只有一条**：`sys_device.device_id` 的形态 CHECK。`fingerprint_hash` 列**不建议加**（唯一「想要的消费者」会引入新故障）；`legacy_device_id`/双读窗口已拍板不做。
3. **90 天留存清理可同批做**，但判据**不能只用 `stale`**（它只覆盖「从没有过心跳」的行，漏掉「用过之后放弃」的主群）；且**必须同事务删 `app_monitor_user`**（否则 `uq_monitor_visitor` 会把同指纹回访钉成 40000），而 `app_monitor_user` 在 **RLS 表里**，删除必须走 system 通道。
4. **B5 第 2 步留了两处运行时已坏 + 一处断言已陈**：本轮实测 2 个 api-spec = `12 failed | 7 passed (19)`。这是最大意外，见 §3。
5. 握手自愈链**能走通**，但不是「40012 一跳」—— 实际 `40605 → 40012 → 40113 → 20000` **三跳**，三跳各有前端分支（`interceptor.ts:105 / 114`、`:85`）。验收必须把三个 code 都钉住，否则「自愈成功」与「恰好没触发」不可区分（§4）。

---

## 1. 到底需要哪些 DDL

### 1.1 现状盘点（dev 库实测，不是读 migration 猜的）

```
migrations 已应用：… 10 RefreshTokenActiveUnique1793370000000 / 11 DeviceStaleFlag1793380000000
sys_device 约束：pk_sys_device / ck_device_risk_score / 其余全是 NOT NULL（**device_id 目前没有任何 CHECK**）
sys_device 索引：pk_sys_device / uq_device_id / uq_device_name / idx_device_created_at
                / idx_device_stale ON (updated_at) WHERE stale = true
指向 sys_device 的 FK：fk_rt_device(auth_refresh_token)、fk_user_device_device(sys_user_device)
  confupdtype='a'（NO ACTION）  confdeltype='c'（CASCADE）   ← 两处都是
sys_device 现有行：total=11，64-hex 旧形态=11，d1_ 形态=0，stale=true 9，active=true 0，
                  banned=0，locked=0，updated_at 超 90 天=0，created_at 超 90 天=0
子表行数：sys_user_device=0，auth_refresh_token=0，app_monitor_user=2（都能 join 到现有设备）
```

DDL 源头：`apps/server/apps/api/migrations/1792922206018-InitSchema.ts:210-238`（建表 + 3 索引 + 1 CHECK）、
`apps/server/apps/api/migrations/1793380000000-DeviceStaleFlag.ts:22-30`（`stale` 列 + 部分索引；`IF NOT EXISTS` 幂等风格，`down` 逐条反向）。

**全仓没有 `ON UPDATE` 动作**：`git grep -n 'ON UPDATE' -- apps/server` → 0 命中。M2 想加的东西当前 schema 里不存在；加它必须 `DROP CONSTRAINT + ADD CONSTRAINT`（两表各一次全量 FK 重校验 + ACCESS EXCLUSIVE 锁）。

### 1.2 `fingerprint_hash` 列还需要吗 —— **不需要（建议不加）**

读码事实：

- `git grep -rn 'fingerprint_hash\|fingerprintHash' -- apps/server apps/admin packages` → **0 命中**。它从来不存在，加了就是全新列。
- 指纹**已经**以原样落库：`app_monitor_user.visitor_id`（`InitSchema.ts:166`，`uq_monitor_visitor` 唯一）。再存一份哈希是重复持久化，且决定 4 已明确 visitor_id 保留不动。
- 唯一「今天就想读它」的消费者是心跳校验：`apps/server/libs/app-domain/src/monitor/user/user.service.ts:85-96` 用 `HMAC(指纹) === deviceId` 判「这条心跳属于这台设备」。B5 之后该等式**恒假**（§3 有实测），于是会有人想「把指纹存进 sys_device，改成和存的值比」。
  **建议明确否掉**：设备 id 随机化后指纹会**合法漂移**（换 GPU 驱动 / 字体 / 窗口尺寸都会变 canvas/WebGL 哈希），把「指纹必须等于首见值」做成硬校验 = 给正常用户造一个**没有自愈路径**的永久 40099。今天不明显，因为指纹一变 deviceId 就跟着变、行也换了。
- 将来真做风控特征/关联执法（决定 5 已否执法），届时加一个**可空**列 + 从 `app_monitor_user.visitor_id` 回填即可。现在加 = 「为对齐计划加无消费者 DDL」，与拍板 6 冲突。

→ **结论：不加。** 心跳那处校验改成「与本设备已存行比」或摘掉，见 §3.4。

### 1.3 `device_id` 形态 CHECK —— **要加**（本轮唯一必需 DDL）

理由：

- 形态判据在代码里已有唯一真源：`apps/server/libs/system/src/device/device-id.ts:20-24`（`/^d1_[0-9a-f]{32}$/` + `WALNUT_DEVICE_ID_PREFIX`）。数据库 CHECK 是**唯一一层代码绕不过去**的守卫：将来任何新写腿（脚本、临时 SQL、DTO 漏校验）写 64-hex 会拿 **23514**（可控、带约束名），而不是悄悄铸出一个身份。
- 它同时是「硬切」在 schema 里的落款：读 `\d sys_device` 就知道旧形态不受支持。

实测（dev 库、事务内、已回滚）：

```
CHECK 正则命中现有行：total=11, matches_new_form=0
ALTER TABLE sys_device ADD CONSTRAINT ck_device_device_id_form CHECK (device_id ~ '^d1_[0-9a-f]{32}$')
  => ERR code=23514 | check constraint "ck_device_device_id_form" of relation "sys_device" is violated by some row
回滚后约束残留：0
```

所以顺序上必须**先清旧行再加约束**，否则 `migration:run` 直接红。11 行旧形态的处理（实测依据：`banned=0 / locked=0`、`sys_user_device=0`、`auth_refresh_token=0`，只有 2 行 `app_monitor_user` 挂在这 11 台设备上）：

```sql
-- dev 库一次性 pre-step（用 DATABASE_PG_USER，BYPASSRLS）
BEGIN;
DELETE FROM app_monitor_user
 WHERE device_id IN (SELECT device_id FROM sys_device WHERE device_id !~ '^d1_[0-9a-f]{32}$');
DELETE FROM sys_device
 WHERE device_id !~ '^d1_[0-9a-f]{32}$';
COMMIT;
```

**为什么必须连带删 monitor 行**：`app_monitor_user.visitor_id` 全局唯一（`InitSchema.ts:177`）。只删设备行、留下 monitor 行，同浏览器回来是**新 deviceId + 老 visitor_id** ⇒ 心跳首次 insert 撞 `uq_monitor_visitor` ⇒ 23505 ⇒ 40000，那台设备心跳永久坏。这条对 90 天清理同样成立（§2.4）。

migration 形状（照 `DeviceStaleFlag` 的幂等风格，必须写 `down`）：

```sql
-- up
ALTER TABLE sys_device
  ADD CONSTRAINT ck_device_device_id_form CHECK (device_id ~ '^d1_[0-9a-f]{32}$')
-- down
ALTER TABLE sys_device DROP CONSTRAINT IF EXISTS ck_device_device_id_form
```

两个提醒：

1. 正则**必然在 SQL 里复制一份**（migration 不能 import lib 的值）。用一条 drift spec 钉住：读 `apps/api/migrations/*.ts` 源码文本，断言其中出现与 `WALNUT_DEVICE_ID_PREFIX` + 32-hex 同形的模式（仓库已有源码扫描式 drift spec 先例：`apps/api/src/common/monorepo/repo-global.drift.spec.ts`、`guard-order.drift.spec.ts`）。
2. 若希望「migration 在任何库上都不失败」，可改 `ADD CONSTRAINT ... NOT VALID` + 单独 `VALIDATE CONSTRAINT`（NOT VALID 对新写入**立即生效**，只跳过存量行校验）。但**建议就用会失败的那版**：这轮是硬切，库里有旧行正是要被拦下的状态；一条永远绿的 migration 会把「还有旧行」藏起来。

### 1.4 M2 的 `ON UPDATE CASCADE` —— **不需要（你的判断成立），加了更糟**

#### (a) 代码里没有任何 UPDATE `sys_device.device_id` 的路径

```
$ git grep -n -i 'update sys_device' -- apps/server packages      → 0 命中
$ git grep -n '.deviceId *=' -- apps/server                      → 0 赋值（唯一命中是 user_device.service.ts:59 的 === 比较）
$ git grep -n 'findDeviceByDeviceIdAndUpdate' -- apps/server
   device.service.ts:258              patch = Pick<…,'locked'|'banned'>   ← 只写锁/封
   shared/device.shared.service.ts:23 { active }                       ← 只写 active
   （其余 2 处是 spec）
$ git grep -n 'markDeviceStale' -- …/device.repo.service.ts         ← 只写 stale/active
```

`sys_device` 的全部写腿只有 5 条，**没有一条把 `device_id` 改成另一个值**：

| 写腿 | 位置 | 写哪些列 |
|---|---|---|
| initial 的 upsert | `libs/system/src/device/device.basic.repository.ts:39-53` | `deviceData` 整集（含 `deviceId`，**与入参同一值**） |
| 锁 / 封 | `libs/system/src/device/device.service.ts:251-258` | `locked` / `banned` |
| active 翻转 | `libs/identity/src/user_device/shared/user_device.shared.service.ts:123-167` | `active`（+ 经 markDeviceStale 写 `stale`） |
| stale 标记 | `libs/system/src/device/repo/device.repo.service.ts:64-82` | `stale` / `active` |
| IP/位置变更 | `libs/system/src/device/repo/device.repo.service.ts:153-215` | `ip` / `location_*` / `ip_history` |

即使 upsert 的 `Object.assign(existing, deviceData)` 带上了同值 `deviceId`，TypeORM `save()` 的列差分会把**未变化的列排除**在 `UPDATE SET` 之外；**即使**它出现在 SET 里，PG 的 ON UPDATE 级联触发器也只在键值**真的变了**时才动（实测 A1/B1）。

**反例也没有**：`sys_device.id`（uuid 主键）从不被任何 FK 引用（实测 `pg_constraint.confrelid` 只有两条、都指向 `device_id` 列），所以不存在「按 uuid 改名」的旁路。

#### (b) PG 行为实测（临时表 + 全程 `ROLLBACK`，不碰业务数据）

```
A1 现状 FK（仅 ON DELETE CASCADE）：同值 UPDATE p.id      => OK affected=1      ← 同值不报错、不级联
A2 现状 FK：改值 UPDATE p.id                               => ERR 23503
   | update or delete on table "p" violates foreign key constraint "ch_pid_fkey" on table "ch"
B1 M2 形态 FK（ON UPDATE CASCADE）：同值 UPDATE p2.id      => OK affected=1
B2 M2 形态 FK：改值 UPDATE p2.id                           => OK affected=1
B3 子表 pid 实际值                                        => [{"pid":"d1_y"}]  ← 子表被静默改写
```

#### (c) 结论

- **不需要**：没有任何路径 UPDATE `device_id`；同值 UPDATE 在现状 FK 下也不报错（A1）。
- **不需要是为了更安全**：万一将来真有人写改名（迁移脚本、修数据），**现状 FK 会 23503 硬失败**（A2）—— 免费的最后防线；换成 ON UPDATE CASCADE，同一次事故会变成**静默把别人的会话/绑定行搬到新键**（B2/B3），属于「用一条 DDL 把响亮的错误换成沉默的错误」。
- **成本也不小**：加它要 `DROP + ADD` 两个 FK（各一次全表校验 + ACCESS EXCLUSIVE），收益 0 —— 与拍板 6「不许加无用 DDL」冲突。

> 计划文档 `apps/docs/src/zh-CN/content/industry-research/backend-architecture-review/10-implementation-plan.md:422`
> 的「改键前先加 ON UPDATE CASCADE」是**为「原地换发（rename 键）」方案写的**。硬切把换发改成「换 cookie」，那条前提整条作废 —— 本报告是它的修订依据（该文件属冻结语料，不回头改正文）。

### 1.5 本轮 DDL 清单（一句话版）

| DDL | 要吗 | 依据 |
|---|---|---|
| `ADD CONSTRAINT ck_device_device_id_form CHECK (device_id ~ '^d1_[0-9a-f]{32}$')` | **要（唯一一条）** | §1.3 |
| 清 11 行旧形态（数据操作，不是 DDL） | 要（pre-step，含连带删 2 行 monitor） | §1.3 实测 23514 |
| `fingerprint_hash` 列 | **不要** | §1.2 |
| `legacy_device_id` 列 / 双读窗口 | 不要 | 已拍板硬切 |
| `ON UPDATE CASCADE`（两处 FK） | **不要，且有害** | §1.4（A1/A2/B2/B3） |
| 给留存清理加新索引 | 不要 | 表规模是「设备数」；已有 `idx_device_stale` |
| 删 `idx_device_stale` | 不要 | 无害；删它要额外 DDL、收益 0 |

---

## 2. 90 天留存清理

### 2.1 放在哪

**新建一个独立的 `@Cron` 服务**，不要塞进现有 `updateDeviceActiveStatus`：

- 现任务在 `apps/server/apps/api/src/modules/techniques/task/task.service.ts:127-142`（`EVERY_30_MINUTES`），语义是「把没心跳的设备标 stale」（`libs/identity/src/user_device/shared/user_device.shared.service.ts:123-167`），而且**整个任务体被 `isDev` 门住**（`user_device.shared.service.ts:124-130` 直接返回 0）—— 把物理删除挂进去等于「dev 永远测不到、生产每 30 分钟删一次」。
- 物理清理的现成先例：`apps/server/libs/auth/src/modules/refresh/repo/refresh.pg.purge.service.ts:20-62`（独立服务 + `@Cron(EVERY_HOUR)` + `cronLock.runExclusive` + 「没拿到锁返 null，不伪装成删了 0 行」）。照这个形状做 `libs/system/src/device/repo/device.pg.purge.service.ts`：
  - `@Cron(CronExpression.EVERY_DAY_AT_3AM)`（避开 00:00 校钥 / 01:00 MFA / 02:00 settings+locale）；
  - 任务名进 `apps/server/libs/const/src/app/task.ts`（例：`SYS_DEVICE_RETENTION_PURGE: 'SystemDeviceRetentionPurgeTask'`）；
  - **不要**加 bootstrap 入口（`bootstrap-task.module.ts` 那 6 个是预热/清理缓存，留存删除不该每次启动跑）；
  - 归属与其余 cron 一致：`WORKER_STANDALONE=true` 时由 worker 跑（`apps/api/src/app/schedule.composition.ts:50-53`），无需额外开关。
- 数据访问下沉到 repo（`device.repo.service.ts` 已有 QueryBuilder 先例），cron 服务只编排 + 打日志。

### 2.2 判据：「不能用 `stale` 单独判」

读码事实：

- `stale = true` 只在**「设备 active=true 但 `app_monitor_user` 查不到行」**时打（`user_device.shared.service.ts:139-159`）。
- 「用过之后放弃」走另一条腿：monitor 行还在、只是 `last_active_at` 老了 ⇒ 只会 `updateDeviceActive(deviceId,false)`（`:144-147`），**`stale` 永远是 false**；且一旦 `active=false` 就再也不会进 `getAllActiveDevices()` 的循环 ⇒ **永远不会被补打 stale**。
- 也就是说：**只按 `stale` 清理会漏掉「真实用过再放弃」这个主群**，只清到「initial 完就没心跳」那部分。

建议判据（全部用行内已有列 + 两个子查询）：

```
active = false                                   -- 当前不在用
AND updated_at < now() - interval '90 days'      -- 90 天内没有任何写活动（initial / 心跳翻 active / IP 变更都推 updated_at）
AND NOT banned AND NOT locked                    -- 见 §2.3
AND NOT EXISTS (活跃 monitor 行)                  -- last_active_at 在 90 天内，或 auth = true
AND NOT EXISTS (未过期且未撤销的 RT)               -- 见 §2.3
```

为什么锚点是 `updated_at` 而不是 `created_at`：`created_at` 只会老，长期活跃设备也会被删。
为什么不能只看 `last_active_at`：`delMonitorByDeviceId` 会删 monitor 行（`user_device.shared.service.ts:154`），行没了就没有 last_active_at，`updated_at` 是**唯一在所有分支下都还在**的活动痕迹（`@UpdateDateColumn`，`entity/device.entity.ts:139-140`）。`stale` 那条腿在 `markDeviceStale` 里也会推 `updated_at`，所以两群都覆盖得到。

### 2.3 绝对不能删哪些行

| 类别 | 删不删 | 为什么 |
|---|---|---|
| `banned = true` | **不删（硬性）** | 行是这条封禁决定的**唯一持久记录**；删掉 = 静默解封（guard 查不到行 → 40605 → 自愈 → 新身份）；且 admin 无法「解封」列表里不存在的设备。成本是一条小行。 |
| `locked = true` | **不删（硬性）** | 同 banned（40606）；且删设备行会 CASCADE 掉 `sys_user_device.locked`。 |
| 有活跃 RT 的行 | 不删（防御） | `fk_rt_device` 是 `ON DELETE CASCADE` —— 删行会**连带删掉未过期会话**（静默踢人）。90 天没动的机器理论上没有活 RT，但别把安全建立在「理论上」。 |
| `active = true` | 不删 | 正在用。 |
| 90 天内有 `last_active_at` 或 `auth=true` 的在线访客行 | 不删 | 心跳是比 `updated_at` 更细的活动证据。 |
| 「连封禁行 90 天后也该清」？ | **不建议** | 封禁记录的价值是「历史执法证据」，不是「当前拦得住」——B5 之后拦不拦得住已不指望它（见 §2.4 末、§5）。清掉只省一点空间，却让「这设备被封过」彻底消失。 |

### 2.4 删行会不会撞 FK / 其它坑

- **不会撞 FK**：两处 FK 都是 `confdeltype='c'`（CASCADE，实测），DELETE 不报错，而是**静默级联删** `sys_user_device`（信任设备绑定）与 `auth_refresh_token`（会话）。这正是要写进日志的语义：**清理 = 连会话与信任绑定一起清**。90 天无活动丢信任绑定合理（下次登录重新信任），但要显式知道。
- **`app_monitor_user` 没有 FK（松引用，`InitSchema.ts:162-180`）**：不显式删就是孤儿；`visitor_id` 全局唯一 ⇒ 同指纹回访撞 `uq_monitor_visitor` ⇒ 23505 ⇒ 40000（心跳永久坏）。**必须同事务删**。
- **`app_monitor_user` 在 RLS 表清单里**（`apps/api/migrations/1793360000000-DataScopePhase3Rls.ts:85-93`，且 `FORCE ROW LEVEL SECURITY`）：cron 没有请求用户 ⇒ 直连 manager 的 DELETE 会被策略过滤成 **affected=0（静默不删）**。必须走系统通道（`withWalnutSystemManager` / `AppMonitorUserRepositoryService` 的方法，内部即 `withSystemManager`，见 `libs/app-domain/src/monitor/user/repo/user.repo.service.ts:59`），或经 identity 端口 `delMonitorByDeviceId`（`libs/identity/src/identity.ports.ts:91`）。
  **`sys_device` 本身不在 RLS 表里**（`apps/api/src/common/repository/data-scope.ts:157` 登记豁免：「无 user_id 列」），DELETE 不受 RLS 影响。
- 跨库依赖：`libs/system` 不能 import `libs/app-domain`（方向相反）。「批量删 monitor 行」要么走既有端口（逐条 `delMonitorByDeviceId`，量小可接受），要么加一个端口方法（推荐，保持不反向依赖）。
- `sys_user_mfa.device_id` / `sys_log_auth.device_id` / `sys_log_operate.device_id` 都是**松引用**（无 FK）：删设备会留下孤儿字符串 —— 那是审计/日志，**应该留下**，不要跟着清。
- `sys_user_lock` 没有 device_id 列（`InitSchema.ts:433-447`），不受影响。

### 2.5 幂等 SQL

一条语句选目标、一条按返回集合删监控行，**同一事务**：

```sql
-- ① 选目标（RETURNING 供 ② 使用；判据全在 WHERE 里 ⇒ 重复执行天然幂等）
DELETE FROM sys_device d
 WHERE d.active = false
   AND d.updated_at < now() - interval '90 days'
   AND d.banned = false
   AND d.locked = false
   AND NOT EXISTS (
     SELECT 1 FROM app_monitor_user m
      WHERE m.device_id = d.device_id
        AND (m.last_active_at > now() - interval '90 days' OR m.auth = true))
   AND NOT EXISTS (
     SELECT 1 FROM auth_refresh_token rt
      WHERE rt.device_id = d.device_id AND rt.revoked = false AND rt.expired_at > now())
 RETURNING d.device_id;

-- ② 连带清 monitor 行（必须走 system 通道，RLS；参数 = ① 的 device_id 数组）
DELETE FROM app_monitor_user WHERE device_id = ANY($1::text[]);
```

幂等性来自「全部谓词都是时间/状态判据」：第二次跑第 ① 步必然 0 行。
可选：给 ① 加批量上限（表小，非必需）。

### 2.6 测试方案

照 `apps/server/apps/api/test/integration/pg.purge.int-spec.ts`（现成 purge 集成测试形状）新建 `device.purge.pg.int-spec.ts`，用真 PG（integration 库，globalSetup 会 drop 重建）：

| # | 造数据 | 断言 |
|---|---|---|
| 1 | A：`active=false, updated_at=now()-91d`，无 monitor 行，未封 | 被删（返回 `[A]`） |
| 2 | B：同 A 但 `banned=true` | 保留 |
| 3 | C：同 A 但 `locked=true` | 保留 |
| 4 | D：`active=true, updated_at=-91d` | 保留 |
| 5 | E：`active=false, -91d` + monitor 行 `last_active_at=now()-1h` | 保留 |
| 6 | F：`active=false, updated_at=now()` | 保留 |
| 7 | G：`active=false, -91d` + 活 RT（`revoked=false, expired_at=now()+1d`） | 保留，且 RT 行还在 |
| 8 | H：`active=false, -91d` + monitor 行 `last_active_at=-100d` | 设备与 monitor 行**都**被删；随后用同一 `visitor_id` 插一行新设备心跳 ⇒ **成功**（证明 `uq_monitor_visitor` 没被钉死） |
| 9 | I：`active=false, -91d` + `sys_user_device` 绑定行 + 过期 RT 行 | 设备被删，两行都被 CASCADE 删（显式断言，别让「静默级联」不被测） |
| 10 | 幂等 | 连跑两次：第一次 `[A,H,I]`，第二次 `[]` |
| 11 | RLS 守卫（反向） | 非 system 通道删同一条 monitor 行 ⇒ `affected=0`；cron 真实实现 ⇒ `affected=1` |

单测（不依赖 PG）可补一条：`cronLock.runExclusive` 返回 undefined（没拿到锁）时 cron 返回 `null` 而不是 0（照 `refresh.pg.purge.service.ts:44-50` 的口径）。

---

## 3. 还有哪些地方假设「指纹派生 id」

> 本节是**本轮最重要的意外**：不是注释陈旧，而是**两处运行时已经坏了**。

### 3.1 运行时已坏（P0）

**（1）`WalnutAdminPipeDeviceId` 仍按 64-hex 校验 —— 4 个路由对真实设备恒 40099**

- `apps/server/libs/pipes/src/base/format.pipe.ts:43-51`：
  ```ts
  /** sys_device.device_id = HMAC-SHA256(fingerprint) hex（device.repo.service getDeviceIdByFingerprint）→ 固定 64 位 hex */
  const DEVICE_ID_PATTERN = /^[0-9a-f]{64}$/i
  ```
- 使用点（4 个，全是路径参数）：`apps/server/apps/api/src/modules/system/identity/user_device.controller.ts:57,75,92,109`（update-name / lock / unlock / force-quit）。真实客户端的 `deviceId` 来自列表接口 ⇒ 现在是 `d1_…` ⇒ **每次被管道拦成 40099**。
- 线上语义：/me 的「我的设备」改名、管理员锁设备/强制下线**全部不可用**。

**（2）心跳的 `HMAC(visitorId) === deviceId` 校验 —— 每次心跳恒 40099**

- `apps/server/libs/app-domain/src/monitor/user/user.service.ts:85-96`（`claimedDeviceId !== deviceId` ⇒ `WalnutAdminExceptionRequestDataError`）。
- 客户端确实还在发指纹：`apps/admin/src/hooks/web/useMonitor.ts:57`（`visitorId: appStoreFingerprint.getFingerprint`）⇒ 真实客户端心跳被自己拒掉。
- 顺带一个**文档与实现对不上**：DTO 注释写的是「body 的 visitorId 与**已存行**不一致即 40099」（`apps/api/src/modules/app/monitor/user/dto/user.dto.ts:72-73`、`:105-106`），实现却是 HMAC 等式。修时照注释写即可（§3.4 选项 A）。
- 依赖它的 mock：`apps/server/libs/app-domain/src/monitor/user/user.service.spec.ts:42-50`。

**（3）一处老断言（不是运行时坏，是测试陈了）**

- `apps/server/apps/api/test/api/user-device.api-spec.ts:119-120`：`expect(item.deviceName).toContain('api-spec-')` —— deviceName 已改服务端生成（`desktop_<8hex>`）。

**实测**（`pnpm vitest run --config ./apps/api/vitest.config.integration.ts <两个文件>`，integration 库、真 HTTP）：

```
FAIL apps/api/test/api/monitor-user.api-spec.ts  ×7
  _devMsg: "monitor state visitorId does not belong to this device
            (expected d1_45bc161d3f08d2cc6eb411ecaf47e505, got 7897bb2101dcc50d67106a17e679025889beb52ba3b485b3ac11c4f3a85389b1)"
FAIL apps/api/test/api/user-device.api-spec.ts    ×5
  _devMsg: "type: param; field: deviceId; expected: 64-char hex string (HMAC-SHA256 of device fingerprint)"   ← 4 条
  AssertionError: expected 'desktop_d79ea5cf' to contain 'api-spec-'                                          ← 1 条
Test Files  2 failed (2)
     Tests  12 failed | 7 passed (19)
```

即：B5 第 2 步的门禁只覆盖了 unit + 两个 device spec；这套 api-spec 没跑，两处 P0 就漏过去了。（`device.api-spec.ts` 仍绿，是因为它只用 `initial` 的响应值 + DTO，不经过那两个坏判据。）

### 3.2 死代码 / 死载荷（P1）

| 位置 | 现在的样子 | 处置 |
|---|---|---|
| `libs/system/src/device/repo/device.repo.service.ts:41-43` | `getDeviceIdByFingerprint(visitorId)` 仍导出 | 唯一消费者是上面那处坏校验；改完即无消费者 ⇒ 删（连同 `libs/crypto/src/crypto.service.ts:130-138` 的 `hashDeviceFingerprint`，或明确保留并注明「只服务历史数据」） |
| `apps/admin/src/api/system/device.ts:72` | 前端仍发 `deviceName: appStoreFingerprint.getDeviceNameFromFingerprint` | 服务端已忽略 ⇒ 删掉这行（无契约变更） |
| `libs/system/src/device/dto/device.dto.ts:205` | `SysDeviceDTOInitialRequest` 仍收 `deviceName` | 可选：从 DTO 摘除（要重导 openapi + 重生成 api-types）；不摘也无害，但契约里留一个「可传但无效」字段 |
| `libs/system/src/device/entity/device.entity.ts:13` | 注释「device_id 是客户端指纹」 | 改注释 |

### 3.3 注释 / 文档（P2，含 OAuth 文档）

| 位置 | 错在哪里 |
|---|---|
| `apps/server/apps/api/src/modules/auth/modules/oauth/gitee/gitee.controller.ts:69` | 「deviceId 是服务端对指纹做 HMAC 得到的 64 位 hex」 |
| `apps/server/apps/api/src/modules/auth/modules/oauth/github/github.controller.ts:69` | 同上 |
| `apps/docs/src/zh-CN/content/backend/modules/auth.md:46` | 「`device_id = hash(X-Fingerprint, crypto.deviceIdKey)`」 |
| `apps/docs/src/zh-CN/content/backend/modules/system-account.md:78-79` | 同上（点名 `getDeviceIdByFingerprint` → `hashDeviceFingerprint`） |
| `apps/docs/src/zh-CN/content/backend/modules/security.md:272` | 「device_id = hash(X-Fingerprint, …)；指纹是客户端自报的请求头」 |
| `apps/docs/src/zh-CN/content/shared/device.md:23,46,110,258` | 整篇按 `HMAC-SHA256(visitorId, DEVICE_ID_ENCRYPTION_KEY)` 写，含 mermaid 时序图 —— 需重写「身份来源」那段 |
| `apps/docs/src/zh-CN/content/backend/configuration.md:41`、`monorepo/env-management.md:104`、`apps/server/AGENTS.md:121`、`apps/server/libs/config/README.md:82` | `DEVICE_ID_ENCRYPTION_KEY` 描述仍是「设备 ID」；应补一句「不再是身份根（不再 HMAC 指纹），保留为历史数据解密根」（与 `10-implementation-plan.md:419` 的裁定一致） |
| `apps/docs/src/zh-CN/content/industry-research/backend-architecture-review/10-implementation-plan.md:414-424` | **不改**（冻结语料）：但它的 M1/M2/M3、`legacy_device_id`、`ON UPDATE CASCADE`、键族 RENAME 四条前提已被硬切作废 —— 以本报告为准 |

门禁提醒：`pnpm lint:docs-refs`、`pnpm lint:doc-ts`、`pnpm build:docs` 会跟着这些改动跑；`reports/` 下的 markdown 不在文档站里，不受死链门禁约束。

### 3.4 心跳校验的修法选项（需拍板）

- **A（推荐，最小）**：照 DTO 注释的口径改成「与本设备已存行比」——`findByDeviceId(deviceId)`，行存在且 `row.visitorId !== body.visitorId` 才 40099；行不存在时按首行登记写入。
  残余风险：**首写可抢占**（别人先用自己的 deviceId 写受害者指纹 ⇒ 受害者首次心跳撞 `uq_monitor_visitor` ⇒ 40000）。这是 B5 的**结构性后果**（随机 id 与指纹之间不再有可计算关系），只能靠产品口径缓解，不是代码 bug。
- **B**：干脆摘掉请求面的 `visitorId`（计划文档 `:429` 原本就想摘）—— 但决定 4 说 `visitor_id` 仍是 socket 房间键 `user:userId:visitorId`，所以**至少首写还得有人写**，B 实际退化成 A。
- **C**：存 `fingerprint_hash` 来恢复强校验 —— 见 §1.2，**不建议**（指纹合法漂移 ⇒ 无自愈路径的永久 40099）。

---

## 4. 握手自愈链路

### 4.1 结论：40012 分支**覆盖这条路径，但它只是三跳中的第二跳**

| # | 触发 | 服务端出处 | 前端处置 |
|---|---|---|---|
| 0 | 旧 cookie（签名合法 + 64-hex 值） | `libs/guards/src/guards/device.guard.ts:94-99`（`isValidDeviceId` 不过 ⇒ 40605） | `interceptor.ts:114-130` `SingletonPromiseDeviceReset` → `app-geo-ip.ts:60-83` 清本地 + 重走 initial → 重放 |
| 1 | 重放带**旧 AES key** 签名、cookie 已是新 id | `libs/guards/src/guards/sign.guard.ts:103` → `libs/cache/src/service/cache.rsa.ts:26-32`（`SECURITY:RSA:PUB_KEY:<newId>` 不存在 ⇒ **40012**） | `interceptor.ts:105-108` `SingletonPromiseRsaPubKeyNotFound` → `app-security.ts:109-112` `signInitialAPI(pubKey, force=false)` → 重放 |
| 2 | 公钥已登记，但 `AES:<newId>` 也没有 | `sign.guard.ts:320-326`（**抛 ExpiredSignature = 40113**，不是 40012） | `interceptor.ts:85-88` `SingletonPromiseSign` → `app-security.ts:114-127`：有密钥对所以**不重握手**，只 `getSignAesKey()`（`POST /security/sign/aes-key`）→ 重放 |
| 3 | 签名用新 AES key | `sign.guard.ts:160-171` 通过 | 20000 |

关键细节：

- `setupSign` 只在「本地没有密钥对」时才登记公钥（`app-security.ts:114-122`）—— 所以第 2 跳**不会**顺手补 AES key，必须靠 `getSignAesSecretKey` 为空触发 `getSignAesKey()`；而 `signAesSecretKey` 是**纯内存**（`app-security.ts:48-50`），密钥对 30 天持久化（`:23-25`）。两条一起决定了「刷新页面也能治」（内存 AES 清空 ⇒ bootstrap `setupSign` 走 `getSignAesKey`），而「会话内自愈」必须靠 40113 分支。
- `/security/sign/initial` 与 `/system/device/initial` 都豁免了 Sign/Cap/Jwt/Lock/Device（`apps/api/src/modules/security/sign/sign.controller.ts:31-35`、`apps/api/src/modules/system/device/device.controller.ts:47-52`），两跳不会自锁。
- 只有 40605 有「每个请求只自愈一次」的旗标（`apps/admin/src/utils/axios/types.d.ts:18` 的 `_deviceResetRetried`）；40012 / 40113 **没有**上限 —— 若某跳失效会变成无限重放（**未实测**，建议顺手补旗标）。
- 附带后果（预期，不是 bug）：deviceId 换了 ⇒ `auth_refresh_token` / `sys_user_device` / 权限缓存 / MFA 缓存全按旧 deviceId 键 ⇒ **该用户等于被登出一次**。硬切当天「所有人被踢下线一次」是这条链的必然结果。
- `initial` 有限流（`apps/server/libs/system/src/device/device.setting.service.ts:11-15`：limit=4 / 60s，超限 42900）；一次正常自愈只打 **1** 次 initial，安全；「自愈失败 + 用户狂刷」会撞 42900 → /not-allowed。

### 4.2 端到端验证的具体做法

**（A）自动化：在 api-spec 里钉三跳（推荐，可进门禁）**

用现成的 `WalnutApiClient`（`apps/server/apps/api/test/api/helpers/api-client.ts`，已有 `dropCookie/setCookie/getCookie/handshakeAesKey/deviceId`）：

1. `const c = await WalnutApiClient.create(app)` → 记 `A = c.deviceId`（`create()` 已消费 1 次 initial 额度）。
2. **造 40605**：`c.setCookie(DEVICE_ID, c.getCookie(DEVICE_ID) + 'tamper')` → 打任一受设备保护的端点 → 断言 `code === 40605`。
   （合法的「64-hex 旧 cookie」只有服务端能签出来，所以用「签名被破坏的值」作为 **guard 拒值** 的等价替身；「64-hex 具体被拒」由 `isValidDeviceId` 单测 + CHECK 的 int-spec 各自覆盖，别在一个用例里混两层判据。）
3. **自愈第 1 跳**：`c.dropCookie(DEVICE_ID)` → `POST /system/device/initial` → 断言 `20000`、`B = data.deviceId`、`B !== A`、`isValidDeviceId(B)`。
4. **自愈第 2 跳**：直接 `c.root('GET', …)` / `c.anon('POST', …)`（**不重跑握手**）→ 断言 `code === 40012`。
5. `POST /security/sign/initial { rsaPubKey, force: false }` → `20000` → 再重放 → 断言 `code === 40113`。
6. `POST /security/sign/aes-key` → `20000` → 用同一私钥解信封、把新 aes key 装回客户端（需要一个 test-only setter，`api-client` 现在只有 getter）→ 再重放 → **断言 20000**。
7. 收尾：`SELECT … FROM sys_device WHERE device_id = B` 存在且 `active = true`；`A` 那行已不存在（或按用例自己清理）。

**判定「自愈成功」而不是「恰好没触发」的三条判据（缺一不可）**：

- `B !== A` —— 证明第 0 跳真的跑了（不是复用旧 id）；
- 中间两个 code **各出现恰好一次**（`40012`、`40113`）—— 证明第 1、2 跳真的需要、且真的被执行；
- **负对照**：同一序列里**跳过**第 5 步（不登记公钥）直接重放，必须**稳定停在 40012**。若跳过也能 20000，说明这条链根本没被触发，前面的绿是假的。

**（B）手工（dev 上验证真实浏览器行为，最贴近事故现场）**

硬切后最有价值的验证是「**保留旧 cookie 直接刷页面**」：

1. 部署前在浏览器里留住旧 `WALNUT_DEVICE_ID`（签名合法、值 64-hex），**不要清 cookie**。
2. 跑完 migration + 重启 api；DevTools → Network 勾 **Preserve log**，刷新页面。
3. 期望顺序固定：`POST /system/device/initial` → `20000` 且 `data.deviceId` 以 `d1_` 开头 → 原请求重放 → `40012` → `POST /security/sign/initial` → 原请求重放 → `40113` → `POST /security/sign/aes-key` → 原请求 `20000`。
4. DB 核对：`SELECT device_id, device_name, active, created_at FROM sys_device ORDER BY created_at DESC LIMIT 3` —— 新 id 在、`device_name` 形如 `desktop_[0-9a-f]{8}`。
5. 负对照：先 `redis-cli DEL "WALNUT_CACHE_SECURITY:RSA:PUB_KEY:<新id>"`（或临时注释 40012 分支）再刷，必须卡在 40012 —— 证明这条跳必需。

---

## 5. 风险清单（最可能翻车的三点 + 判据）

**风险 1（已发生，最高）：B5 第 2 步留了两处运行时 P0，门禁没覆盖到**

- 事实：`WalnutAdminPipeDeviceId` 仍 64-hex（4 路由）、心跳仍做 HMAC 指纹校验（每次心跳）—— 实测 `12 failed | 7 passed`。
- 判据：`pnpm test:integration`（integration 配置会把 `apps/api/test/api/**/*.api-spec.ts` 全收）必须全绿；收尾提交必须包含 `monitor-user.api-spec.ts` + `user-device.api-spec.ts` 的通过记录（不是只有 device 两个 spec）。
- 附带判据：`pnpm openapi:check`（若动 DTO/管道，openapi.json 与 api-types 会漂移）。

**风险 2：90 天清理把 `app_monitor_user` 留成孤儿 ⇒ 同指纹回访 40000（且 RLS 会让删除静默失效）**

- 事实链：`uq_monitor_visitor` 全局唯一 + monitor 行无 FK 不级联 + `app_monitor_user` 强制 RLS（非 system 通道删 0 行）。
- 判据：§2.6 第 8、11 条（清理后用同一 `visitor_id` 重新登记必须成功；system 通道 `affected=1`，普通通道 `affected=0`）。

**风险 3：自愈链只验到 40012 就收工，把「三跳」当成「一跳」**

- 事实：40012 → 40113 是两跳（公钥 vs AES key 是两族键），且 `setupSign` 不会替你补 AES key。
- 判据：三码各出现一次 + `B !== A` + 负对照停在 40012；以及「一次自愈只打 1 次 `/system/device/initial`」（不撞 4/60s 限流）。

**并列候选（不是最可能，但要知道）**：硬切当天**全员被登出一次**（RT 按 deviceId 键）+ **旧行的 banned/locked 随删行一起消失**。
判据：dev 库现在 `banned=0 / locked=0`（已实测），所以这轮删行不丢任何执法记录；生产若是有真实封禁的库，删行前必须先导出 `banned=true` 的行。

---

## 6. 要做什么 / 不做什么

### 要做

1. **一个 migration**：`ck_device_device_id_form` CHECK（+ `down`），配套 dev pre-step 清 11 行旧形态（含连带删 2 行 `app_monitor_user`）；实测 up/down 各一次。
2. **修 `WalnutAdminPipeDeviceId`**：形态判据搬到中立常量（`libs/const`，别让 `pipes` 依赖 `system`），管道改谓词式；同步 `apps/api/src/common/pipes/pipes.spec.ts:58-70`。
3. **修心跳校验**：按 §3.4-A（与本设备已存行比）或拍板后的方案；同步 `libs/app-domain/src/monitor/user/user.service.spec.ts:42-50`。
4. **修 3 处老断言**：`user-device.api-spec.ts:119-120`（deviceName）、`pipes.spec.ts`、`user.service.spec.ts`。
5. **删前端死载荷** `apps/admin/src/api/system/device.ts:72` 的 `deviceName`。
6. **90 天留存清理**：新 cron 服务（`libs/system/src/device/repo/device.pg.purge.service.ts`）+ task name + 90 天常量 + `device.purge.pg.int-spec.ts`（11 条用例）。
7. **文档同步**（§3.3 全表）+ 注释（`device.entity.ts:13`、两个 OAuth controller `:69`）。
8. **跑满门禁**：unit + integration（含上述 2 个修好的 spec）+ `types:check` + `openapi:check`（若动 DTO）+ `lint:docs-refs` / `build:docs`（若动文档）。

### 不做

1. `ON UPDATE CASCADE`（M2）—— 无路径，且把硬失败换成静默改写。
2. `legacy_device_id` / 双读窗口 / 60 天窗口 / 键族 RENAME —— 硬切不换发，全部作废。
3. `fingerprint_hash` 列 —— 没有今天成立的消费者（唯一那个会引入指纹漂移故障）。
4. 按指纹的关联执法 —— 已否。
5. 为清理加新索引、删 `idx_device_stale` —— 都属「为对齐计划加无用 DDL」。
6. 动 `app_monitor_user.visitor_id`（列、唯一约束、房间键语义）—— 决定 4。
7. 清 `sys_log_auth` / `sys_log_operate` / `sys_user_mfa` 里指向已删设备的松引用 —— 那是审计，故意留。

---

## 7. 待 Lead 拍板（4 条）

| # | 问题 | 我的建议 | 影响面 |
|---|---|---|---|
| P1 | 心跳的 `visitorId` 归属校验怎么改 | **A：与本设备已存行比**（照 DTO 注释的口径）；接受「首写可抢占」的结构性残余 | 1 个 service + 2 个 spec；若选 C（存指纹）要多一列 + 引入指纹漂移故障 |
| P2 | 11 行旧形态：迁移内删 vs 迁移前手删 | **迁移前手删**（脚本 + `RETURNING` 记账），migration 保持 schema-only、可 revert、不做数据删除 | 迁移可逆性 vs 一命令完成；若迁移内删，`down` 无法恢复数据，必须在报告里明写「不可回滚」 |
| P3 | 90 天判据的锚点 | `active=false AND updated_at < 90d` + 排除 banned/locked/活 RT/90 天内有心跳 | 决定清理覆盖面（只按 `stale` 会漏主群） |
| P4 | 是否把 `deviceName` 从 `SysDeviceDTOInitialRequest` 摘除 | 可摘（服务端已忽略）；但要重导 openapi + 重生成 api-types，并把「载荷名字不再生效」写进 API 描述 | 若摘，本轮还得跑 `pnpm openapi:check`；不摘则契约里留一个「可传但无效」字段 |

---

## 8. 附录：本轮用过的命令与原始输出

```
# 1) 全仓「有没有 UPDATE device_id」
git grep -n -i 'update sys_device' -- apps/server packages            → 0
git grep -n '.deviceId *=' -- apps/server                            → 0 赋值
git grep -n 'ON UPDATE' -- apps/server                                → 0
git grep -n 'fingerprint_hash|fingerprintHash' -- apps/server apps/admin packages → 0
git grep -n 'getDeviceIdByFingerprint' -- .                          → 实现 device.repo.service.ts:41；消费者 user.service.ts:89；注释/文档 5 处；spec 2 处

# 2) dev 库实测（node + pg）
FK：fk_rt_device / fk_user_device_device → confupdtype='a'，confdeltype='c'
现有行：total=11，64hex=11，d1_=0，stale=9，active=0，banned=0，locked=0，updated>90d=0
CHECK 试加（事务内）：23514 "is violated by some row"，回滚后约束残留 0

# 3) PG 级联语义实测（临时表，全程 ROLLBACK）
A1 同值 UPDATE + 现状 FK            → OK
A2 改值 UPDATE + 现状 FK            → 23503（硬失败）
B2 改值 UPDATE + ON UPDATE CASCADE  → OK，子表被静默改写为 d1_y

# 4) 两个 api-spec（integration 配置，真 PG / 真 HTTP）
pnpm vitest run --config ./apps/api/vitest.config.integration.ts   apps/api/test/api/monitor-user.api-spec.ts apps/api/test/api/user-device.api-spec.ts
→ Test Files 2 failed (2) | Tests 12 failed | 7 passed (19)
   根因 2 类：pipe(64-hex) ×4 路由、心跳 HMAC(visitorId) ×7 用例；另 1 条 deviceName 断言陈了
```

**未实测项（别当成结论）**：`/security/sign/aes-key` 之后客户端签名转正的那一跳是**读码推演**（`sign.guard.ts:320-326` 抛 40113 → 前端 `interceptor.ts:85` 分支 → `app-security.ts:129-140`），没有在真浏览器里跑过；建议按 §4.2-B 手工实测一次再收尾。
