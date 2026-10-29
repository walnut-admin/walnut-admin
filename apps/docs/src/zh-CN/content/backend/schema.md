# 数据模型与表设计（PostgreSQL）

这是站内的**持久化设计摘要**：表清单、关键约束、FK 政策与迁移纪律。逐列真源是
`apps/server/apps/api/src/modules/**/entity/*.entity.ts` 与
`apps/server/apps/api/migrations/1792922206018-InitSchema.ts`；迁移前的完整推演在
`docs/plans/postgres-migration-phase2.md`。本篇不复制 phase2 的逐表字段表，只保留「改表前必须知道」
的判据。

运行侧的连接、seed、导出与脱敏见 [数据库与初始化数据](./postgresql.md)；各域的行为语义见
[系统核心域](./modules/system-core.md)、[认证全链](./modules/auth.md)、
[数据域与 techniques](./modules/system-data.md)、[app 模块族与 shared](./modules/app-shared.md)。

## 1. 总览

### 1.1 规模与来源

MongoDB 侧的 24 个集合 1:1 映射为表，数组字段 `sys_user.roles` / `sys_role.menus` 拆成 2 张
关联表，共 **26 张表：24 张主表 + 2 张 junction**。关联表没有独立业务语义，只有复合主键和
两个 CASCADE 外键。

计数口径（phase2 §1，2026-10-25 定稿）与 InitSchema 一致：26 表、298 列、17 个 jsonb 列、
17 个 FK。列数含 `id` 与时间列；索引数含 PK 与唯一索引。**数字随 migration 演进**，改表时以
migration 为准，不要拿本篇当列清单。

### 1.2 uuid 三通道

| 通道 | 覆盖 | 生成方式 |
|---|---|---|
| v5 存量 | ETL / seed 重建的全部既有行 | `deriveUuid(原 24 位 hex)`，全库统一 namespace，幂等可重跑 |
| v7 新增 | `sys_log_auth` / `sys_log_operate` / `sys_deleted` / `auth_refresh_token` | 列默认 `uuidv7()`（时间有序，追加型大表写放大低） |
| v4 新增 | 其余 22 张表 | 列默认 `gen_random_uuid()`（PG 13+ 内置） |

- v5 的 namespace 常量与派生函数唯一真源在 `packages/tooling/scripts/src/db/uuid5.ts`，
  **永不可改**：改了等于全部存量 id 换世界。
- 应用层不强制生成 id：插入不传 id 时由 DB 默认生成。v5 只出现在 seed / ETL 两条显式通道，
  正常业务路径永远拿 v4。
- v7 的四张表都是日志 / 回收站 / 会话性质，id 粗略暴露创建时间无保密诉求；业务表不采用 v7。

### 1.3 命名与公共列

- 表名 = 原集合名（已是 snake_case）；列名 snake_case（`userName` → `user_name`）。API 出参
  仍是驼峰，映射在实体 `@Column({ name })` 里显式写出，**不注册全局 SnakeNamingStrategy**
  （保留字改名如 `sort_order` / `is_show` / `is_left` 策略表达不了，且隐式全局违反仓库纪律）。
- 保留字改名三处：`order` → `sort_order`（role / menu / lang / dict_data）、`show` → `is_show`、
  `left` → `is_left`。
- 约束命名：PK `pk_<table>`；外键 `fk_<语义>`；CHECK `ck_<table>_<语义>`；唯一与普通索引
  `uq_*` / `idx_*`。注意 `uq_*` 在 DDL 里是**唯一索引**（partial unique 只能以索引表达），
  `pk_*` 是表约束。
- 公共列：`id uuid`（见 §1.2）、`created_at timestamptz`、`updated_at timestamptz`。例外：
  `shared_area` 无时间列；`sys_log_auth` 只有 `authenticated_at`；`sys_log_operate` 只有
  `operated_at`；`auth_refresh_token` / `app_error` 只有 `created_at`；`sys_deleted` 用
  `deleted_at`；`app_monitor_user` 用 `first_visit_at` / `last_active_at`。

### 1.4 FK 三分政策

| 政策 | 落点 | 理由 |
|---|---|---|
| `ON DELETE CASCADE` | 业务从属表：`sys_user_role`、`sys_role_menu`、`sys_locale.lang_id`、`sys_dict_data.type_id`、`sys_user_device.user_id` / `device_id`、`sys_user_identity.user_id`、`sys_user_lock.user_id`、`sys_user_mfa.user_id`、`sys_user_oauth.user_id`、`sys_user_preference.user_id`、`auth_refresh_token.user_id` / `device_id` | 主行彻底删除后从属行已无意义；用数据库机制替代原先散在 service 里的级联删除。真正删用户只发生在回收站「彻底删除」路径，快照仍在 `sys_deleted` |
| `ON DELETE SET NULL` | `sys_user.current_role_id` → `sys_role` | 角色进回收站后用户回到「无当前角色」，与既有业务语义一致 |
| `ON DELETE RESTRICT` | `sys_menu.pid` 自引用 | 防误删静默扩面；子树处理在应用层，父节点有子节点时硬删撞 23503 |
| 不建 FK（松引用） | 日志/审计/回收站（`sys_log_auth` / `sys_log_operate` / `sys_deleted` / `app_error` / `app_monitor_user`）、`app_setting.created_by`、`sys_user_mfa.device_id`、`shared_area.pcode` | 审计必须比被引用对象活得久；MFA 凭据不应随设备行删除而消失；area 的 `pcode='0'` 是约定根值不是行引用 |

设备引用有一处特例：`sys_user_device.device_id` 与 `auth_refresh_token.device_id` 是**按业务键**
（`sys_device.device_id`，该列 UNIQUE）建 FK，而不是按 `sys_device.id`。这样设备行被删时，
绑定与会话令牌随 CASCADE 清理。

### 1.5 索引策略

- 有列表页的表：默认排序列 `created_at DESC` 索引（无 `created_at` 的表用其时间列）。
- 模糊搜索：只有 `sys_locale.key` 建 `pg_trgm` GIN（`idx_locale_key_trgm`），其余字符串列
  默认只建 B-tree；出现真实慢查询再补，不预铺。
- **本仓没有行级软删标志**：软删 = 快照进 `sys_deleted` + 硬删原行，因此不存在 `is_deleted`
  过滤列或软删复合索引。
- `*_created_at DESC` 带排序方向、trgm GIN、partial unique / partial index、CHECK、FK 的
  on delete 行为都是 **migration-only**：实体 `@Index` 表达不了 DESC / 操作符类 / 全部 DDL
  语义。`typeorm migration:generate` 对账时这些 diff 属预期，不许照 generate 输出删
  migration 侧索引。

## 2. 表清单

按域分组。**公共列不再重复**；「关键列」只列 PK / 唯一 / FK / jsonb / 枚举列，「关键索引与约束」
只列具名对象。逐列类型、NULL、默认值看实体与 migration。

### 2.1 身份与权限

| 表 | 用途 | 关键列 | 关键索引与约束 |
|---|---|---|---|
| `sys_user` | 用户档案 | `id` PK；`user_name`（可空、部分唯一）；`current_role_id` FK → role（SET NULL）；`role_mode` CHECK（`switchable` / `combinable`，默认 `switchable`）；`mfa_setup` | `pk_sys_user`；`fk_user_current_role`；`ck_user_age` / `ck_user_gender` / `ck_user_role_mode`；`uq_user_name`（`WHERE user_name IS NOT NULL`）；`idx_user_created_at`（DESC）；`idx_user_current_role` |
| `sys_role` | 角色 | `role_name` 唯一；`sort_order` | `pk_sys_role`；`uq_role_name`；`idx_role_created_at`。**不提供 delete 端点**（P3-7） |
| `sys_menu` | 菜单 / 路由 / 元素权限；meta 19 字段拍平 | `pid` 自引用 FK（RESTRICT，根为 NULL）；`type` CHECK（`catalog` / `menu` / `element`）；`name` 部分唯一；`permission`；`watermark` jsonb；`cache_key_strategy` CHECK | `pk_sys_menu`；`fk_menu_pid`；`ck_menu_type` / `ck_menu_ternal` / `ck_menu_cache_key_strategy`；`uq_menu_name`（partial）；`idx_menu_pid`（partial）；`idx_menu_status_sort_order` |
| `sys_user_role` | 用户-角色 junction | PK `(user_id, role_id)`；双 FK CASCADE | `pk_sys_user_role`；`fk_user_role_user` / `fk_user_role_role`；`idx_role_id`（角色反查用户数） |
| `sys_role_menu` | 角色-菜单 junction | PK `(role_id, menu_id)`；双 FK CASCADE | `pk_sys_role_menu`；`fk_role_menu_role` / `fk_role_menu_menu`；`idx_menu_id` |

junction 表没有软删快照：主行硬删时由 FK CASCADE 清空，恢复主行不恢复授权（P2-18）。

### 2.2 设备与会话

| 表 | 用途 | 关键列 | 关键索引与约束 |
|---|---|---|---|
| `sys_device` | 设备档案与画像 | `device_name` / `device_id` 双唯一；`device_info` / `hardware_info` / `location_info` / `location_history` 四个 jsonb；`sr_height` / `sr_width` / `vp_height` / `vp_width` / `geo_longitude` / `geo_latitude`；`risk_score` CHECK 0–100；`ip_history text[]` | `pk_sys_device`；`ck_device_risk_score`；`uq_device_name`；`uq_device_id`；`idx_device_created_at` |
| `sys_user_device` | 用户-设备绑定与可信状态 | FK `user_id` → user（CASCADE）；FK `device_id` → device(device_id)（CASCADE）；`uq_user_device(user_id, device_id)`；`trusted` / `trusted_expired_at` | `pk_sys_user_device`；`fk_user_device_user` / `fk_user_device_device`；`ck_user_device_link_type`；`uq_user_device`；`idx_user_device_device`；`idx_user_device_created_at` |
| `auth_refresh_token` | RT 行存储（revoke-and-insert） | `id uuidv7()`；`jti` 唯一；FK `user_id` → user（CASCADE）；FK `device_id` → device(device_id)（CASCADE）；`revoked`；`revoke_reason` CHECK（含 `rotate`） | `pk_auth_refresh_token`；`fk_rt_user` / `fk_rt_device`；`ck_refresh_token_revoke_reason`；`uq_jti`；`idx_rt_user` / `idx_rt_device` / `idx_rt_expired`（purge 判据） |

同一 `(user_id, device_id)` 可以有多行 RT：历轮 `rotate` 撤销行 + 恰一行现役行。表上没有
`(user_id, device_id) WHERE revoked = false` 的部分唯一索引，登录并发判据仍是读后写（P2-14）。

### 2.3 账户外围

| 表 | 用途 | 关键列 | 关键索引与约束 |
|---|---|---|---|
| `sys_user_identity` | 登录 / 安全身份（phone、email、idCard、password） | FK `user_id` CASCADE；`type` / `purpose` CHECK；`value` 密文、`value_hash` 查找键、`masked_value`；`metadata` jsonb | `pk_sys_user_identity`；`fk_user_identity_user`；`ck_user_identity_type` / `ck_user_identity_purpose`；`uq_identity(user_id, type, purpose)`；`idx_identity_type_hash(type, value_hash)` |
| `sys_user_lock` | 用户锁屏偏好 | FK `user_id` CASCADE + UNIQUE（一用户一行）；`lock_route` jsonb；`lock_mode` CHECK（`default` / `idle` / `security`） | `pk_sys_user_lock`；`fk_user_lock_user`；`ck_user_lock_mode`；`uq_user_lock_user` |
| `sys_user_mfa` | TOTP / WebAuthn 凭据 | FK `user_id` CASCADE；`device_id` **松引用**（不建 FK）；`webauthn_counter bigint`；`webauthn_transports text[]` 带数组元素 CHECK；`webauthn_credential_id` 部分唯一；`backup_codes_ciphertext text[]` 存「确定性哈希再 AES-GCM 加密」的备用码（P3-23） | `pk_sys_user_mfa`；`fk_user_mfa_user`；`ck_user_mfa_type` / `ck_user_mfa_webauthn_transports`；`idx_user_mfa_user`；`uq_user_mfa_credential`（partial）。`phone_number_ciphertext` 为预留列（SMS MFA 未实现，P3-23） |
| `sys_user_oauth` | 第三方账号绑定 | FK `user_id` CASCADE；`provider` CHECK（`google-one-tap` / `gitee` / `github`）；`uq_oauth(provider, provider_id)` | `pk_sys_user_oauth`；`fk_user_oauth_user`；`ck_user_oauth_provider`；`uq_oauth`；`idx_oauth_user` |
| `sys_user_preference` | 前端偏好 | FK `user_id` CASCADE + UNIQUE；`font_size` / `color_mode` / `cvd` / `layout_mode` CHECK；`layout` jsonb | `pk_sys_user_preference`；`fk_user_preference_user`；四个 `ck_user_preference_*`；`uq_user_preference_user` |

这五张表都是 `user_id` CASCADE。删用户时它们被硬删且不进 `sys_deleted` 快照，恢复用户只插回
主行（P2-22）。

### 2.4 配置与国际化

| 表 | 用途 | 关键列 | 关键索引与约束 |
|---|---|---|---|
| `sys_lang` | 语言 | `lang` 唯一（取值域 = contract `Locale`）；`sort_order`；`status` | `pk_sys_lang`；`uq_lang`。表体量个位数，无 created_at 索引 |
| `sys_locale` | 某语言下的 `key → value` 翻译 | FK `lang_id` → lang（CASCADE）；`value` 可空（NULL = 未翻译）；`uq_locale_lang_key(lang_id, key)` | `pk_sys_locale`；`fk_locale_lang`；`uq_locale_lang_key`；`idx_locale_key`；`idx_locale_key_trgm`（GIN `gin_trgm_ops`，全库唯一 trgm） |
| `sys_dict_type` | 字典类型 | `type` 唯一；`name` 是 i18n key；`status` | `pk_sys_dict_type`；`uq_dict_type`；`idx_dict_type_created_at` |
| `sys_dict_data` | 字典数据 | FK `type_id` → type（CASCADE）；`label` 是 i18n key；`sort_order`；`tag_type` CHECK（`primary` / `info` / `success` / `warning` / `error`） | `pk_sys_dict_data`；`fk_dict_data_type`；`ck_dict_data_tag_type`；`idx_dict_data_type_order(type_id, sort_order)` |
| `app_setting` | 应用配置（auth / global / functional） | `setting_key` 唯一；`setting_value` 是 **text**（JSON 文本，非 jsonb，Q4 定案）；`setting_type` CHECK；`created_by` 松引用 | `pk_app_setting`；`ck_app_setting_type`；`uq_setting_key`。无 created_at 索引（表小） |

### 2.5 日志、审计与回收站

| 表 | 用途 | 关键列 | 关键索引与约束 |
|---|---|---|---|
| `sys_log_auth` | 登录日志（追加型） | `id uuidv7()`；只有 `authenticated_at`；`user_id` / `device_id` 松引用；`user_name` 快照；`type` CHECK（opaque / qrcode / otp / emailAddress / phoneNumber / github / gitee / googleFedCM） | `pk_sys_log_auth`；`ck_log_auth_type`；`idx_log_auth_at`（DESC）/ `idx_log_auth_user` / `idx_log_auth_device` |
| `sys_log_operate` | 操作日志（追加型） | `id uuidv7()`；只有 `operated_at`；`title` NOT NULL；`action_type` CHECK（含 REFRESH / AUTH）；`operation` **可空** varchar(32)；`method` CHECK；`request_data` / `response_data` / `snapshot_before` / `snapshot_after` jsonb + 两个 `raw_*` text 旁路；`user_id` / `device_id` 松引用 | `pk_sys_log_operate`；`ck_log_operate_action_type` / `ck_log_operate_operation` / `ck_log_operate_method`；`idx_log_operate_at`（DESC）/ user / device |
| `sys_deleted` | 回收站快照（单表，所有 model） | `id uuidv7()`；`content` jsonb（原行快照）；`model_name` 恢复路由键；`deleted_id`；`deleted_by` / `log_operate_id` 松引用；`deleted_at` 可空 | `pk_sys_deleted`；`idx_deleted_model_at(model_name, deleted_at DESC)`；`idx_deleted_id`；`idx_deleted_by` |
| `app_error` | 未受控异常落库 | 只有 `created_at`；`headers` / `payload` jsonb + `raw_payload` text 旁路；`user_id` 松引用；`response_code` varchar(16)（contract 是数值码，写入转 text）；`method` / `env` CHECK | `pk_app_error`；`ck_app_error_method` / `ck_app_error_env`；`idx_error_created_at`（DESC）；`idx_error_user` |

`sys_deleted.content` 只快照**主行**：junction 与账户外围表不进去，恢复主行后这些关联缺失
（P2-18 / P2-22 / P2-23）。这是「单表 jsonb 快照」的边界，不是 bug 修复前请按取舍使用。

### 2.6 应用与参考数据

| 表 | 用途 | 关键列 | 关键索引与约束 |
|---|---|---|---|
| `app_demo` | CRUD 教学模板 | `demo_string` / `demo_phone_number` 唯一；6 个数组列 NOT NULL（`text[]` / `integer[]` / `boolean[]` / `timestamptz[]` / `smallint[]` / `uuid[]`）；`demo_enum` CHECK（1–4）；`demo_object` jsonb | `pk_app_demo`；`ck_app_demo_enum`；`uq_demo_string`；`uq_demo_phone_number` |
| `app_monitor_user` | 在线访客 / 用户监控 | `visitor_id` 唯一；`user_id` / `device_id` 松引用；`auth` / `focus` / `is_left`；`first_visit_at` / `last_active_at`（无 created/updated） | `pk_app_monitor_user`；`uq_monitor_visitor`；`idx_monitor_device`；`idx_monitor_user`。**无 `last_active_at` 索引**（列表默认按它排序，P3-30） |
| `app_key` | RSA / AES / JWT 密钥材料 | `key` 唯一；`type` CHECK（RSA_PAIR / AES_KEY_URL / JWT_AT / JWT_RT）；`status` CHECK（ACTIVE / DEPRECATED / DISABLED）；`version`；`valid_start` / `valid_end`；`meta` jsonb（一列多型） | `pk_app_key`；`ck_app_key_type` / `ck_app_key_status`；`uq_key`；`idx_app_key_status`。**无 `(type, version)` 唯一、无 ACTIVE 部分唯一**：并发 rotate 靠事务内 `FOR UPDATE`（P1-1） |
| `shared_area` | 行政区划邻接表（约 66.3 万行） | `code` 唯一 varchar(12)；`pcode` varchar(12) **不建 FK**；`name`；无时间列 | `pk_shared_area`；`uq_area_code`；`idx_area_pcode` |

`shared_area` 的 code 长度实际分布是 2/4/6/9/12（12 位村级占 93%），不是早期判断的
1/2/4/6/9；DDL 已放宽为 varchar(12)。`pcode` 不建 FK 的理由见 §3.5。

## 3. 设计决策摘要

### 3.1 meta 拍平（Q1）

`sys_menu.meta` 的 19 个固定字段全部拍平成列，不存 jsonb。理由：`meta.status` 是角色 populate
的过滤条件、`meta.order` 是排序键，拍平才能进 CHECK / NOT NULL / 索引；jsonb 需要表达式索引，
还失去默认值与 NOT NULL 表达力。实体侧由 `assembleSysMenuMeta` / `flattenSysMenuMeta` 组装回
`meta` 对象，前端无感。`meta.watermark` 是自由配置对象，保留 jsonb。

### 3.2 软删快照单表 jsonb（§5.3）

所有 model 的删除都进 `sys_deleted` 一张表，`content` 是 jsonb 原行快照，`model_name` 是恢复
路由键。好处是回收站只有一套查询/恢复通道，jsonb 让「按内容关键字检索被删行」成为普通 SQL；
恢复按 `model_name` 查显式注册表（不是运行时动态模型）。代价：只快照主行，junction 与外围表
不恢复（§2.5 的边界）。

### 3.3 日志松引用、不建 FK（Q3）

`sys_log_auth` / `sys_log_operate` / `sys_deleted` / `app_error` / `app_monitor_user` 对
`user_id` / `device_id` 一律只留 uuid/text 列 + 索引，不建 FK。理由：审计记录必须比被引用对象
活得久；建 FK 会阻止「用户进回收站后彻底删除」，或在 CASCADE 下静默销毁审计记录。

### 3.4 MFA 不建 device FK（Q5）

`sys_user_mfa.device_id` 只做松引用。MFA 凭据是用户资产，不应因为设备行被删而级联消失；设备
删除时更合理的语义是凭据保留、等待用户重新绑定。对照：`auth_refresh_token.device_id` 建了
FK CASCADE —— 会话令牌随设备清理才是正确语义。

### 3.5 area 不建 FK（Q6）

`shared_area.pcode` 不建 FK。顶层省份的 `pcode='0'` 是约定根值而非行引用（Mongo 侧本就无
约束）；伪根行方案要求 ETL 凭空造一行，弃用。父子完整性由应用层删除校验（有子节点不许删）+
ETL 装载后的孤儿/环检测兜底；递归 CTE 再以 `CYCLE` 子句做 SQL 层最后兜底。

### 3.6 jsonb 与 text[] 的边界（§5.5）

17 个 jsonb 列的共同判据是「整体读写、无字段级查询，或一列多型」：设备画像四列、身份 metadata、
锁屏 lock_route、偏好 layout、操作日志的请求/响应与前后快照、`sys_deleted.content`、
`app_demo.demo_object`、`app_error.headers` / `payload`、`app_key.meta`、`sys_menu.watermark`。
同质字符串数组用 `text[]`（可建 GIN、元素类型明确），不用 jsonb 数组；`sys_menu.meta` 主体
明确拒绝 jsonb 化（§3.1）。

### 3.7 时间戳不用触发器（§5.4）

`created_at` / `updated_at` 由 TypeORM 的 `CreateDateColumn` / `UpdateDateColumn` + 列级
`DEFAULT now()` 维护，不部署 `updated_at` 触发器。理由：数据只经 ORM 写入；66 万行 COPY 时
触发器是纯开销；触发器是数据库里的隐式写路径，与「行为显式可见」的仓库纪律冲突。配套约定：
**任何 raw SQL UPDATE 必须显式 `SET updated_at = now()`**。

### 3.8 零配置默认与列默认是两层

`sys_user.role_mode` 的列默认是 `switchable`，但权限计算的零配置 effective roleMode 默认是
`combinable`（P2-9）。前者是 AT payload / 守卫短路读的行值，后者是菜单与权限串合并的判据；
两层在默认部署下可以不一致（P2-19）。读代码时不要把它们当成同一个值。

## 4. migration 纪律

- **`synchronize: false` 从第一天锁死**：运行时连接（`apps/server/libs/db/src/pg.service.ts`）与
  CLI 数据源（`apps/api/src/database/data-source.cli.ts`）都硬编码，不给环境变量开口子。
- **`migrationsRun: false`**：应用启动不自动跑迁移；结构演进只经显式命令：
  `pnpm migration:run` / `pnpm migration:revert`（从 `apps/server/` 执行）。
- **初始迁移是手写的**：`apps/api/migrations/1792922206018-InitSchema.ts`。`migration:generate`
  只用来产出骨架，以下类别必须人工复核/手写，否则 generate 会漏或写错：
  partial unique index（`WHERE` 子句）、CHECK 约束、`pg_trgm` GIN、FK 的 `ON DELETE` 行为、
  复合 PK、`uuidv7()` 默认值、数组元素 CHECK。
- **migration 是可执行真源**：实体注释与 phase2 都可能滞后；冲突时以 migration 为准，并同步
  修正注释/文档，不允许用 `synchronize` 反推。新的结构变更一律新增 migration 文件，不改已发布
  的初始迁移。
- `CREATE EXTENSION IF NOT EXISTS pg_trgm` 在初始 migration 首段（PG 18 trusted extension，
  无需超级用户）。
- seed / ETL 是**数据通道**，不进 migration；migration 只管结构。两者正交，见
  [数据库与初始化数据](./postgresql.md)。
- 初始 migration 的实体侧对账注意：`@Index` 表达不了 `DESC` 排序方向与 trgm 操作符类，
  这两类只存在于 migration。generate 对账出现这类 diff 属预期，不要照 generate 删索引。

## 5. entity ↔ migration ↔ phase2 三方核对（2026-10-28）

抽样四张表逐项核对（列数 / 约束名 / 索引名），并核对总览计数：

| 表 | phase2 列数 | migration 列数 | entity 列数 | 约束名 / 索引名 |
|---|---:|---:|---:|---|
| `sys_user` | 13 | 13 | 13 | `pk_sys_user`、`fk_user_current_role`（SET NULL）、`ck_user_age` / `ck_user_gender` / `ck_user_role_mode`、`uq_user_name`（partial）、`idx_user_created_at`（DESC）、`idx_user_current_role` 全部一致 |
| `sys_menu` | 29 | 29 | 29 | `pk_sys_menu`、`fk_menu_pid`（RESTRICT）、`ck_menu_type` / `ck_menu_ternal` / `ck_menu_cache_key_strategy`、`uq_menu_name`（partial）、`idx_menu_pid`（partial）、`idx_menu_status_sort_order` 全部一致；**CHECK 取值域有漂移**（见下） |
| `sys_log_operate` | 25（总览口径） | 25 | 25 | `pk_sys_log_operate`、`ck_log_operate_action_type` / `ck_log_operate_operation` / `ck_log_operate_method`、`idx_log_operate_at` / user / device 一致；**operation 的 NULL 性与长度有漂移**（见下） |
| `app_key` | 11 | 11 | 11 | `pk_app_key`、`ck_app_key_type` / `ck_app_key_status`、`uq_key`、`idx_app_key_status` 一致；无 `(type, version)` 唯一 / ACTIVE 部分唯一，与 P1-1 的「锁方案」一致 |

**结论：结构层面无漂移。** 26 张表、298 列、17 个 FK 与 phase2 总览一致
（`sys_user_mfa` 的 `webauthn_counter bigint` 曾被脚本粗算漏掉，手工复核后计入）；抽样四张表的
约束名与索引名全部对得上。发现的是**注释/文档层面的滞后**：

1. **`sys_menu.cache_key_strategy` 的 CHECK 取值域**：phase2 §4.3 写 `('name','path')`，实体
   注释也写 `('name','path')`；migration 实际是 `('name','path','custom')`，并在原位注明
   2026-10-27 由「枚举三方守卫」抓出补 `custom`。以 migration 为准，文档/注释待同步（P3-25）。
2. **`sys_log_operate.action_type` 的 CHECK**：phase2 §4.16 列 8 个值；migration 实际含
   `REFRESH` / `AUTH`（共 10 个），实体注释仍写 8 个值。P3-24 原判「const 里的 REFRESH/AUTH
   会撞 CHECK」在**当前 migration 上不成立**，需要按 migration 重审并修注释（P3-25）。
3. **`sys_log_operate.operation`**：phase2 写 `varchar(16) NOT NULL`；migration 是
   `varchar(32) NULL`，实体同 migration。这是 B8 的显式裁定（CRUD 装饰器不传 operateType，
   运行时恒 undefined，NOT NULL 会让大部分日志行静默丢失），不是漂移；读 phase2 时注意这一处。
4. **phase2 的小节标题列数**：`app_setting` 小节写 8 列（实际 9，含 `created_by`）、
   `app_error` 小节写 15 列（实际 16）、`sys_log_operate` 小节写 23 列（实际 25，含两个
   `raw_*` 旁路）。总览表的 9/16/25 才是正确口径；小节标题是补列前的旧值。
5. **实体 `@Index` 与 migration 的预期不对称**：`idx_user_created_at`（DESC）与
   `idx_locale_key_trgm`（GIN）只在 migration；这是有意为之（`@Index` 表达不了），
   `sys_user.entity.ts` 头注已写明「generate 对账时这两类 diff 属预期」。

后续改表时按同一方法核对：先看 migration 的 `CREATE TABLE` / `CONSTRAINT` / `CREATE INDEX`，
再对实体列名与 `@Index`，最后对 phase2 的表格；三者不一致时以 migration 为准并补注释。
