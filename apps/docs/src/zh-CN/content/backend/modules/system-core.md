# 系统核心域（user / role / menu / dict / lang / locale）

系统核心域覆盖后台的「人、权、菜单、文案、字典」五件事，落地为六个模块：
`system/user`、`system/role`、`system/menu`、`system/dict`、`system/lang`、`system/locale`。
其中 user / role / menu 三张表与两张 junction 表串成**权限推导链路**（本篇的核心流程）；
dict / lang / locale 是三组互相独立的配置数据。

本文写**当前实现**（PostgreSQL 迁移后）。认证与令牌的细节见 [认证全链](./auth.md)，
全局守卫链与方法级权限守卫的通用语义见 [安全与 guard 链](./security.md)；
已知缺陷的登记与裁决见 `apps/server/apps/api/test/api/DESIGN-ISSUES.md`（下文以 `P?-?` 引用）。
表设计依据 `docs/plans/postgres-migration-phase2.md` §4.1 ~ §4.7。

源码入口：`apps/server/apps/api/src/modules/system/`。接口矩阵的原始测绘在
`apps/server/apps/api/test/api/ENDPOINTS.md` §5；权限链路的实测锚点在
`apps/server/apps/api/test/api/permission-chain.api-spec.ts`。

## 1. 域总览

### 1.1 六个模块的职责

| 模块 | 源码目录 | 职责 | 主表 |
|---|---|---|---|
| user | `libs/identity/src/user/`（HTTP 面 `modules/system/identity/`） | 用户行、角色绑定 junction、自助资料、角色/角色模式切换 | `sys_user` + `sys_user_role` |
| role | `modules/system/role/` | 角色行、菜单授权 junction、权限链路的角色侧入口 | `sys_role` + `sys_role_menu` |
| menu | `modules/system/menu/` | 菜单/路由/元素权限行，meta 拍平列，权限串来源 | `sys_menu` |
| dict | `modules/system/dict/` | 字典类型与字典数据（枚举值、标签 i18n key） | `sys_dict_type` + `sys_dict_data` |
| lang | `modules/system/lang/` | 语言条目（`en_US` / `zh_CN` 等）与公开语言列表 | `sys_lang` |
| locale | `modules/system/locale/` | 某语言下 `key → value` 的翻译行与消息聚合 | `sys_locale` |

所有表都带公共列 `id`（uuid）/ `created_at` / `updated_at`。删除统一走
「写 `sys_deleted` 快照（content 为 jsonb 原行）+ 硬删原行」的软删语义，实现见
`apps/server/libs/repository/src/pg-base.repository.ts` 的
`deleteSoftById` / `deleteSoftManyByCondition`。

### 1.2 表关系

```text
sys_user 1 ── N sys_user_role N ── 1 sys_role 1 ── N sys_role_menu N ── 1 sys_menu
   │                                                                       │
   └── current_role_id ── FK → sys_role(id) ON DELETE SET NULL             └── pid 自引用 FK RESTRICT

sys_dict_type 1 ── N sys_dict_data          （FK ON DELETE CASCADE）
sys_lang      1 ── N sys_locale              （FK ON DELETE CASCADE；UNIQUE (lang_id, key)）
```

关键列与约束（详见 phase2 §4.1 ~ §4.7）：

| 表 | 关键列 / 约束 |
|---|---|
| sys_user | `user_name` 部分唯一（`WHERE user_name IS NOT NULL`）；`role_mode` CHECK IN (`switchable`,`combinable`)；`current_role_id` 可空；`status` / `mfa_setup` |
| sys_user_role | PK `(user_id, role_id)`；双 FK CASCADE；`idx_role_id` 供角色反查用户数 |
| sys_role | `role_name` UNIQUE；`status`；`sort_order` |
| sys_role_menu | PK `(role_id, menu_id)`；双 FK CASCADE；`idx_menu_id` |
| sys_menu | `pid` 自引用 FK **RESTRICT**（根节点 pid=NULL）；`name` 部分唯一；19 个 meta 字段拍平为列（`sort_order` / `is_show` 等，phase2 Q1 定案） |
| sys_dict_type | `type` UNIQUE；`name` 是 i18n key |
| sys_dict_data | `type_id` FK CASCADE；`label` 是 i18n key；`tag_type` CHECK 枚举 |
| sys_lang | `lang` UNIQUE（取值域 = `@walnut/contract` 的 `Locale`） |
| sys_locale | `value` 可空（NULL = 未翻译）；`uq_locale_lang_key (lang_id, key)`；`key` 另有 B-tree + pg_trgm GIN 索引 |

两张 junction 表没有独立主键之外的列，也没有软删快照：原行被硬删时 junction 由 FK
CASCADE 一并消失（这个边界的影响见 §9 的 P2-18）。

## 2. 权限推导链路

这是本篇的核心流程：**菜单树 → 角色菜单 junction → 权限串 → Redis 缓存 → 权限守卫**。

### 2.1 全链步骤

1. **登录时固化 AT payload**。`AppTokenService.getJwtAccessTokenPayload`
   （`@walnut-server/token` 的 `token.service.ts`）从 `sys_user` 行 + `sys_user_role` 读出的
   `roles_list` 组装：`roleIds`、`roleNames`、`currentRole`、`currentRoleName`、
   `roleMode`、`mfaSetup`、`mfaVerified`。**角色分配与 role_mode 在 AT 有效期内不会自动更新**
   （payload 是登录时快照；F1 起权限计算不信任它，见第 3 步）。
2. **客户端拉 `GET /auth/permissions`**。`AuthController.getPermission` →
   `AuthService.getAuthPermissions` → `SysMenuSharedService.getPermissions(user, deviceId)`。
3. **权限计算**。`getCorePermissions(user, ALL)` → `SysRoleSharedService.getCoreMenus`：
   - 读 `APP:SETTING` 的 `app.functional.role`，经 `SharedScopeResolverService.resolve`
     得到 **effective roleMode**（见 §2.2）；
   - **P1-18 根修（F1）**：先按 `user.userId` 从 `sys_user_role` 现查实际绑定
     （`findRoleIdsByUserId`，按 role_id 排序），把 payload 过滤到 membership 内：
     COMBINE 取 `user.roleIds ∩ 实际绑定`；SWITCH 的 `currentRole` 仍在绑定集才用它，
     否则回退绑定集首角色，绑定为空 → 空 payload。旧 AT 重拉不会复活被移除角色，
     恢复用户（junction 未恢复）后权限为空；
   - `findRolesWithPopulatedMenus`：先按 id 批查、**过滤 role.status=true**，再逐个角色
     JOIN `sys_role_menu` 取菜单并**过滤 menu.status=true**，菜单行经 `assembleSysMenu`
     组装回 meta 对象；多角色菜单按 `id` 去重（`uniqBy`）。
4. **root / visitor 短路**：若启用角色的**第一个** `roleName` 是 `root` 或 `visitor`，
   改用 `findAllMenus()`（**全表，不筛 status**）；否则取 `findAllRootMenus()`
   （`pid IS NULL`，按 `order` + `createdAt` 排序）加上角色授予的菜单。
5. **产出四类结果**。`getStrings` 取 `meta.permission` 为真值的行（权限串原样，不做通配展开）；
   `getMenuTree` / `getRouteTree` 过滤掉 `type=element` 的行后按 `id/pid` 建树、按
   `meta.order` 排序；`keepAliveNames` 取 `type=menu` 且非 external 且 `meta.cache=true`
   的 `name`；`affixedTabs` 取 `type=menu` 且 `meta.affix=true`；`internalIframeList`
   取 `meta.ternal=internal` 且 `meta.url` 非空的行。
6. **写权限缓存**。`getPermissions` 在返回前调用
   `AppTechCachePermissionsService.setPermissions`，键
   `AUTH:PERMISSIONS:<userId>:<deviceId>`（deviceId 来自签名 `DEVICE_ID` cookie）。
   `currentRoleName === 'visitor'` 时**跳过写入**。TTL 现状是
   `getAccessTokenExpireSeconds() * 1000`（P1-15：缓存服务收的是秒，实际放大约 1000 倍）。
7. **权限守卫读缓存**。方法级 `WalnutAdminGuardPermission`
   （`apps/server/apps/api/src/guard/permission.guard.ts`）：
   - 无权限元数据 → 告警放行；无 `req.user` → 40105；
   - root 短路：`roleMode=combinable && roleNames[0]='root'`，或
     `roleMode=switchable && currentRoleName='root'`；
   - visitor 特例：仅 `switchable + currentRoleName='visitor'` 生效，只允许
     `app:shared:ali:sts` 与以 `:list` / `:read` 结尾的权限串（数组按 `every`）；
   - 其余用户读 `AUTH:PERMISSIONS:<userId>:<deviceId>`：**键缺失直接 40105，没有懒重建**；
     单串用 `includes` 等值匹配；数组默认 `and`（`every`）或显式 `or`（`some`）。
8. **缓存的唯一写入口是 `GET /auth/permissions`**；`POST /auth/signout` 的
   `clearDeviceCache` 删除该键。其余变更路径的失效覆盖面见 §2.4。

守卫判定是**精确全串匹配**：菜单里的 `meta.permission` 写什么，缓存里就存什么，
`*:*:*` 只是一个普通字符串，没有通配语义。授予 `system:user:*` 不会放行
`system:user:list`。

### 2.2 effective roleMode：GLOBAL / LOCAL 与零配置默认

`app.functional.role` 的形状是 `{ scope, globalValue, localKey, defaultRole }`：

| scope | 取值 | 语义 |
|---|---|---|
| `global`（缺省） | 恒返回 `globalValue` | 用户行上的 `role_mode` 不参与权限计算 |
| `local` | 读用户行 `roleMode`（`localKey`），缺失时回退 `globalValue` | SWITCH / COMBINE 由每个用户自己决定 |

**零配置默认（P2-9 已修，2026-10-28）**：`app_setting` 无该行时，
`cache.appSettings.ts` 的 `defaultFunctionalRole` 是
`{ scope: global, globalValue: combinable, localKey: 'roleMode' }` —— 即默认部署下
**所有用户的全部角色菜单与权限串都被合并**，用户行上的 `role_mode` 被权限计算忽略。
把 setting 改成 `scope: local` 后，用户自身 `role_mode` 才生效（`permission-chain.api-spec.ts`
的 SWITCH/COMBINE 对照用例即按这个手法切换）。

> 注意 effective roleMode 与 AT payload 的 `roleMode` 是**两层判据**：payload 里的是
> `sys_user.role_mode` 列（登录时快照），权限守卫的 root/visitor 短路与
> `me/role/switch` 的准入都读行值；菜单与权限串的合并读的是 effective 值。两层在默认
> 部署下可以不一致（P2-19 已修 switchRole 一侧：它不再被 effective 值卡死）。

### 2.3 SWITCH 与 COMBINE

| 模式 | 权限计算（`getCoreMenus`） | 登录态校验（`checkUserAndRoleStatus`） |
|---|---|---|
| `switchable` | 只取 `currentRole` 一个角色（且先按 junction 实际绑定过滤） | 当前角色必须在 `roles_list` 里且 `status=true`；找不到当前角色只记日志、不拦截（权限计算侧已由 P1-18 根修按 membership 过滤，脱钩行不会沿用旧角色） |
| `combinable` | 取 `roleIds` 全部角色并集 | `roles_list` 非空且至少一个角色 `status=true` |

- `roleIds` / `roleNames` 顺序来自 `findByIds`（`WHERE id IN (...)`，**无 ORDER BY**），
  root/visitor 短路依赖 `roleNames[0]`，因此多角色用户是否命中短路取决于数据库返回顺序。
- `switchRole` 的准入判据是用户行值 `sys_user.role_mode`（P2-19，2026-10-29 起）：行值为
  `combinable` 拒 40000，`switchable` 且目标角色在 junction 内即可切换 —— 与 AT payload、
  permission guard 的 root/visitor 短路同源。旧实现按 **effective** roleMode 判，零配置
  部署（GLOBAL/combinable）下对**所有**用户恒 40000。`switchRoleMode` 只写
  `sys_user.role_mode`，不校验 effective 值。

### 2.4 缓存失效的覆盖面

| 事件 | `AUTH:PERMISSIONS` 是否变化 | 依据 |
|---|---|---|
| `GET /auth/permissions` | 覆盖写入（唯一写入口） | `menu.shared.service.ts getPermissions` |
| `POST /auth/signout`（user-logout） | 删除本设备键 | `signout.service.ts clearDeviceCache` |
| `user-kick-other` / `admin-kick` | 删除目标设备三键（会话 / 权限 / MFA） | P2-12 已修复 |
| 角色 `update`（menus 整组替换 / status 翻转） | **删除该角色全部用户的键**（`sys_user_role` 反查 → `AUTH:PERMISSIONS:<user>:*`） | P2-16 已修复 |
| 菜单 create | **不清**（新菜单未挂角色，既有权限串不变） | F3 收窄 |
| 菜单 update | **仅 permission / status 真变化时全量清** | F3 收窄 |
| 菜单 delete | **全量删除 `AUTH:PERMISSIONS:*`** | P2-16 已修复 |
| 用户 `update`（roles 整组替换） | **删除该用户全部设备的键** | P1-18 已修复 |
| `me/role/switch`、`me/roleMode/switch` | **不清**（AT payload 固化角色集，客户端需重新登录 + 重拉权限） | P2-16 维持登记 |
| 自然过期 | TTL = AT 有效期秒数 | P1-15 已修复 |

写在前面：P2-16 / P1-18 修复后，「撤销一个权限」有了服务端主动通道 —— 角色授权、角色
状态、菜单、用户角色集变更都会在事务提交后删对应缓存；客户端下一次受保护请求会因缓存
缺失得到 40105（guard 无懒重建），重拉 `GET /auth/permissions` 即按新授权重建。
菜单维度的失效是**全量清**（影响面覆盖所有用户，按菜单反查不现实，权限缓存可重拉 ——
明确取舍），且只在 delete 或 update 命中 permission/status 时触发（F3：create 与改标题/
图标/排序不清）。用户切换角色/角色模式仍维持「切换后需重新登录」的既有契约（AT payload
的 currentRole 在登录时固化），不在本轮失效范围内。

## 3. 用户生命周期

### 3.1 创建

`POST /system/user`（`system/user/controllers/user.controller.ts`）：

- DTO 白名单是 `userName` / `status` / `roles` 三件，`roles` **必填**（uuid 数组，数组内去重）。
- `SysUserCrudService.create` 先用 `WalnutAdminConstSafeRoleId` 拦截 root / developer 角色的
  v5 uuid（40000），再补默认值（F1 起与 update 口径一致）：
  - `roles` 未给（undefined）→ `[functionalRole.defaultRole]`，`currentRole=defaultRole`；
  - 显式 `roles: []` → junction 空 + `currentRole=null`（不再落 defaultRole 造成脱钩）；
  - 给了角色集 → junction 按集合写，`currentRole=roles[0]`。
- 用户行与 `sys_user_role` junction 由 `SysUserBasicRepository.create` 连续写入，HTTP
  create 挂 `@WalnutTx`（P1-19 已修复）：主行 save、junction delete、junction insert 在
  同一事务，任何一腿失败整体回滚（不再留下「主行已提交、无角色绑定」的脏用户）。
- 接口不接受 `roleMode`，新行的 `role_mode` 走 DB 默认 `switchable`。
- 用户名重复由 DB `uq_user_name` 报 23505，经全局异常处理器收敛为受控 40000（P1-7）。

自动注册（OTP / OAuth 链）走 `SysUserSharedService.createForAuthUser`：
固定 `roles=[defaultRole]`、`currentRole=defaultRole`、`roleMode=switchable`。

### 3.2 读与列表

- `read` 返回用户行 + `roles_list` / `roles_count`（`attachPopulatedRoles`，junction 直读，
  不筛角色状态）。
- `list` 的响应行只裁到 `id / userName / nickName / status / createdAt / updatedAt / roles_count`；
  `roles_count` 是 junction 计数子查询。
- `GET /system/user/me/profile` 同样组装 `roles_list`。

### 3.3 更新与状态管理

`PUT /system/user/:id` 的白名单仍是 `userName` / `status` / `roles`：

- `roles` **未给** → junction 原样不动；**给了**（含 `[]`）→ `delete + insert` 整组替换。
  端点挂 `@WalnutTx`（P1-19 已修复）：用户行 save、junction 替换、current_role 校正同一
  事务，任何一腿失败整体回滚。P1-18 修法：替换后若 `current_role_id` 不在新集合，重置为
  新集合首角色（空集合 → null），并 after-commit 失效该用户全部设备的
  `AUTH:PERMISSIONS:*` 缓存。
- `status=false` 只改行；登录准入由 `checkUserAndRoleStatus` 拒绝（40104 族）。
  AT 已签发的会话不会因此立即失效。
- `role_mode` 与 `current_role_id` 不作为管理端 update 字段，只能走 `me` 的两个 switch 端点。

### 3.4 删除

`DELETE /system/user/:id`：

- 拒绝删除自己（`id === user.userId`）与 safe user id（root / developer 的 v5 uuid），均 40000。
- 其余用户走软删：`sys_deleted` 快照 + 硬删原行。P2-18 修复（2026-10-28）后，主行删除
  前会给 identity / preference / user_device / mfa / lock 五张外围表逐行落快照；P2-22
  （2026-10-29）把 `sys_user_oauth` 绑定纳入同一快照/重放通道。恢复时由 `sys_user`
  组合恢复器联动重放；`sys_user_role` junction 仍不进快照，从回收站恢复后
  `roles_list` 为空：旧 AT 的权限按空 membership 计算（P1-18 根修），重新登录被
  `checkUserAndRoleStatus` 拒绝（opaque finish 链收敛为 40103），需管理员重新分配角色
  （P2-18 维持登记的部分）。

### 3.5 自助资料与角色切换

| 端点 | 行为 |
|---|---|
| `GET /system/user/me/profile` | 当前用户行 + `roles_list` |
| `PUT /system/user/me/profile` | 白名单 `userName` / `nickName` 必填，`avatar` / `description` / `gender` 可选；持久化到用户行 |
| `GET /system/user/me/security-tab2` | TOTP / WebAuthn 两通道的 `{ status, verified }` 形状（端点自带 `TODO should remove`） |
| `PATCH /system/user/me/role/switch/:roleId` | 行值 `role_mode` 必须为 switchable，否则 40000（P2-19）；`roleId` 必须在用户 junction 中；写 `current_role_id` |
| `PATCH /system/user/me/roleMode/switch/:roleMode` | 枚举管道只收 `switchable` / `combinable`；写 `sys_user.role_mode` |

两个 switch 端点都只改库，不回发新 AT；前端需按响应注释重新获取访问令牌并重拉权限。

### 3.6 管理端改密 / 清凭证

不在 system 模块内，而由 auth 的 opaque admin 通道承接（详见 [认证全链](./auth.md) §2.4）：

- `POST /auth/opaque/admin/password/update/{start,finish}`（权限 `system:user:pass:update`）：
  按 `sys_user.id` 定位，替换 password identity，目标用户**所有设备**撤 RT。
- `POST /auth/opaque/admin/password/clear`（权限 `system:user:pass:clear`）：
  删除 password identity，幂等；之后该用户 `login/start` 返回 40103。

### 3.7 登录准入的判定顺序

`SysUserSharedService.checkUserAndRoleStatus`：

1. `user.status=false` → 40104 族；
2. `roles_list` 为空 → 40104 族（所有绑定角色都失效）；
3. `combinable`：没有任何启用角色 → 40104 族；
4. `switchable`：当前角色在 `roles_list` 中时必须启用；**不在列表中只写日志并继续**。

第 4 条的宽松处理与 §2.1 的 `getCoreMenus` 组合起来：P1-18 根修后，权限计算**先**按
`sys_user_role` 实际绑定过滤 payload —— current_role 脱钩（库外写入、恢复用户）时回退绑定集
首角色或空权限，不会沿用已移出角色。管理端 `PUT /system/user/:id` 的角色整组替换同时校正
`current_role_id`（不在新集合 → 新集合首角色 / 空集合 → null），写路径也不再产生脱钩行。

## 4. 菜单

### 4.1 表形态与 meta 拍平

`sys_menu` 是 29 列：基础列（`pid` / `type` / `path` / `name` / `component` / `title` / `icon`）
+ 19 个 meta 拍平列。`meta` 不再以子文档存库（phase2 Q1 定案：`meta.status` 是角色
populate 的过滤条件、`meta.order` 是排序键，拍平才能进约束与索引）。

出入参的转换在 `modules/system/menu/dto/menu.dto.ts`：

| 方向 | 函数 | 语义 |
|---|---|---|
| 入参 | `flattenSysMenuMeta(dto)` | `meta` 整体缺省（null / undefined）→ 不产生任何 meta 列（DB 默认值兜底）；`meta` 给了 → 19 列全量产出，未给的键回填 `SysMenuEntity` 列默认值（`??`：显式 null 也算未给） |
| 出参 | `assembleSysMenuMeta(row)` | 19 列 → `meta` 对象；源缺键时回填同一份 entity 列默认值 |
| 出参 | `assembleSysMenu(entity)` | 原行浅拷贝 + 组装后的 `meta`，供 `plainToInstance` 按名拷贝 |

默认值的单一数据源是 `SysMenuEntity` 的 `@Column({ default })` 元数据，模块加载期解析一次；
DTO 装饰器的 `default` 只服务 Swagger 展示。`meta` 的部分给 出按「整体替换 + 默认值回填」处理，
与迁移前子文档语义一致。

### 4.2 树

| 端点 / 消费方 | 形态 |
|---|---|
| `GET /system/menu/tree` | `{ fullTree, treeWithoutTypeElement, menuActiveNamesOptions }`：`fullTree` = 全部菜单建树后**全部根节点的 children 按根序拼接**（根自身不返回；单根部署即首根 children，P3-18）；`treeWithoutTypeElement` 是同一棵全根树过滤掉 `type=element`；`menuActiveNamesOptions` 是 `type=menu` 行的 `{ name, title }` |
| `GET /auth/permissions` 的 `permissionMenuTree` | 当前用户可见菜单建树后**全部根节点的 children 拼接**（单根部署 = 首根 children；P3-18）；`formatTree` 给非 CATALOG 节点补空 `children` |
| `permissionRouteTree` | 同上但输出 Vue 路由结构（`children` 为空时 omit）；`meta` 合并 `title/type/icon` 到顶层字段 |

建树是「单次全量查询 + 内存 `arrToTree`」，不逐层懒加载。空表时回 `[]`，
`indexMenuName` 回 `''`（P1-8 已修）。多根部署不再截断（P3-18 已修：
`findAllRootMenus` 取全部根，顶层 = 各根 children 拼接）。

### 4.3 删除与级联

`DELETE /system/menu/:id?_cascade=<0|1>`（`WalnutAdminDecoratorQueryDeleteCascade`，
枚举只收 0/1，缺省 0）：

1. 菜单行软删：`sys_deleted` 快照（`modelName` 为 menu）+ 硬删原行；
2. `_cascade=1` 且 `title` 非空时，额外按 `title` 作为 locale `key` 软删该菜单的全部翻译行
   （`SysLocaleService.deleteByKey`，同一 em）；`title` 为空的菜单跳过级联。
3. **级联不删子菜单**：`pid` 自引用 FK 是 `ON DELETE RESTRICT`，父节点仍有子节点时硬删撞
   23503，经全局异常处理器收敛为受控 40000（P1-7）。
4. 硬删菜单会触发 `sys_role_menu` 的 FK CASCADE —— 所有角色的该菜单授权静默消失；
   从回收站恢复菜单不会恢复授权（P2-18）。P2-23（2026-10-29）起恢复菜单会按同 `title`
   联动重放第 2 步级联软删的 locale 快照（翻译回来；授权仍不恢复）。

## 5. 角色

### 5.1 端点与「角色不删」

role 只有 create / read / update / list 四件，**没有 delete / deleteMany**。
这是 P3-7 的明确设计约束：role 是权限链的稳定引用（`sys_user_role`、`sys_role_menu`、
`sys_user.current_role_id` 多处关联），停用走 `update status=false`，解绑走 junction 调整。

### 5.2 menus junction 的三态

`SysRoleBasicRepository.create` / `update` 把 DTO 的 `menus` 数组落到 `sys_role_menu`：

```ts
// menus 未给（undefined）：junction 原样不动；给了（含 []）：delete + insert 整组替换
const shouldReplace = menus !== undefined
```

- create：缺省 `menus ?? []`，即新建角色默认无授权；
- update：`menus` 未给 → 只更新角色行；给了 → 与角色行写入同事务整组替换；
- PK `(role_id, menu_id)` 自带去重，DTO 层另有数组唯一校验。

### 5.3 root 守卫

| 端点 | 判据 | 结果 |
|---|---|---|
| create | `dto.roleName === 'root' \|\| 'developer'` | 40000 |
| update | `dto.roleName === 'root'`，或按 id 读出的行 `roleName === 'root'` | 40000 |
| update | 按 id 查无行 | 交给 repo 抛 40401（不在服务层拦） |

root 角色的识别不再依赖固定 ObjectId：PG 侧是按 ETL 规则派生的 v5 uuid，服务层改用
「root 角色名全库唯一」这一判据。safe role id 常量（root / developer 的 v5 uuid）用于
user create 的拦截。

### 5.4 读出形态

- `read`：角色行 + `menus`（junction 的 uuid 数组）+ `usersCount`（`sys_user_role` 计数子查询）；
- `list`：行 + `usersCount`，`sortOnlyIn` 含 `roleName` / `order` / `status` / `createdAt` / `updatedAt`；
- 权限链路的 `findRolesWithPopulatedMenus`：只保留 `status=true` 的角色，`menusList` 只含
  `status=true` 的菜单，并按 menu id 去重。角色停用即从权限计算中整体消失；
  在 switchable 模式且当前角色被停用时，登录被 40104 族拒绝。

## 6. 国际化

### 6.1 lang / locale 模型

`sys_lang` 一行一种语言：`lang`（contract `Locale` 枚举值，UNIQUE）、`description`、
`sort_order`、`status`。没有 delete 端点（CRUD 四件里只有 create / read / update / list）。

`sys_locale` 一行一个 `(lang_id, key)` 翻译：`value` 可空（NULL = 未翻译），
`uq_locale_lang_key` 保证一语言一键一行，`key` 有 B-tree + trigram GIN 索引。
列表侧的「翻译进度」由 lang 的两个计数子查询与 locale 的分组聚合产出。

### 6.2 公开语言列表与缓存

`GET /system/lang/list/public`：Lock / Sign / Jwt / Cap / Device 全 Free，返回
`status=true` 的 `{ order, lang, description }`（无 id、无 status），经
`@WalnutAdminDecoratorCache` 缓存键 `SYS_LANG_LIST_PUBLIC`。
`SysLangService` 的 create / update 成功后经 `runAfterCommit` 删除该键（P2-5 已修：
响应返回前已失效，public 下次请求回源重建）。

### 6.3 i18n 消息聚合与 `?cache`

`GET /system/locale/message/:locale?cache=1`：Lock / Sign / Jwt / Cap / Device / Ip
全 Free，路由参数不校验枚举（未知语言回退 `en_US`）。

- 聚合 SQL 在 `SysLangRepoService.findMessagesByLang`：
  `COALESCE(jsonb_object_agg(locale.key, locale.value), '{}'::jsonb)`，
  按 `lang.lang = :lang` 过滤；`value` 为 NULL 时保留 `"key": null`，与未翻译语义一致。
- 缓存键 `SYS_LOCALE_MESSAGES:<LANG>`（`-` 换 `_` 后大写），值是 `{ key: value }` 全量 map。
- `?cache=1`（默认）：缓存命中即返回；未命中才查库并回写。
- `?cache=0`：**总是查库**并回写缓存 —— 即「绕过读缓存」同时顺带刷新缓存。

### 6.4 缓存刷新通道

locale 的 create / update / delete / deleteMany 都调用
`SysLocaleSharedService.triggerCacheRefresh`：`runAfterCommit` 里执行
`extractLocaleMessagesIntoCacheForCronJob`，全量重算 **`SYS_LANG_ID_LIST` + 每种语言的
`SYS_LOCALE_MESSAGES`**。菜单删除（`_cascade=1`）与 dictData 删除触发的 locale 级联软删
也走同一个方法，因此同样会刷新。

`SYS_LANG_ID_LIST` 是 locale 入参校验的白名单：`LocaleLangIdValidate` 读缓存，
**缓存缺失或为空时直接放行**；命中时要求 `langId` 在列表内。P2-17（2026-10-29）起
lang 的 create / update 与 locale 走同一刷新通道：after-commit 里先删
`SYS_LANG_LIST_PUBLIC`，再调用 `extractLocaleMessagesIntoCacheForCronJob` 全量重算
`SYS_LANG_ID_LIST` 与 `SYS_LOCALE_MESSAGES`；`lang` 代号被改掉时额外清旧代号的
messages 键。这样新建语言后可以立即写翻译（不再被旧白名单挡成 40099）。

### 6.5 翻译映射端点的二段式校验

locale 的 create / update 的 wire body 不是 DTO，而是**翻译映射**：
`{ key, oldKey?, <langId-uuid>: <翻译值> }` —— 键名是运行时 lang uuid，永远不可能出现在
静态 DTO 的属性集里。这是 P2-10 登记的**有意设计**，管道因此分三段：

1. `TransformedLocaleBody` 内的宽松 `ValidationPipe`：`whitelist: false` +
   `skipMissingProperties: true` + `forbidNonWhitelisted: false`，只做 transform，
   保住 uuid 键；
2. `LocalePayloadTransformPipe`：把每个 uuid 键映射成
   `{ langId, key, value, oldKey }`，一个 body 产出数组；
3. `ParseArrayPipe({ items: SysLocaleDTOCreateRequest })`：对数组逐项按严格 DTO 校验
   （uuid 语法、key 必填、value 可选），失败统一 40099 族。

放宽只覆盖第一段，wire 契约由第三段钉死。这个设计也让「body 里一个 langId 键都没有」的
请求产出空数组直落 service（P3-20）。

create 以 `payload[0].key` 做整键存在性检查（存在即 40001 DataExists），随后逐语言插入；
update 以 `{ key: oldKey, langId }` 定位行，key 改名时先查新键是否已存在（40000），
不存在则按 `oldKey` 找不到行受控失败。

## 7. 字典

### 7.1 模型

- `sys_dict_type`：`type`（唯一业务键）、`name`（i18n key）、`status`、`description`；
- `sys_dict_data`：`type_id`（FK CASCADE）、`label`（i18n key）、`value`、`sort_order`、
  `status`、`tag_type`（`primary/info/success/warning/error`）、`description`。

列表行在实体列之外注入 `dictDataCount`（`sys_dict_data` 计数子查询）。
`GET /system/dict/type/s?types=a,b` 按类型批量返回 `[{ type, name, dictData }]`：
未知 type 直接跳过（`getByType` 回 `[]` 后被 flat），`dictData` 只含 `status=true` 的行、
按 `sort_order` 升序（`idx_dict_data_type_order` 覆盖）。

### 7.2 删除与级联软删

dictType 的 `DELETE`（P2-8 已修，2026-10-28），同一 em 事务内：

1. `deleteSoftManyByCondition({ typeId })` 逐行软删关联 dictData（每行各落一条
   `SYS_DICT_DATA` 快照）；
2. 再快照 + 硬删 type 行（`deleteSoftById`）。

DB 的 `fk_dict_data_type ON DELETE CASCADE` 因此没有行可清。P2-23（2026-10-29）起
`sys_dict_type` 的恢复器是组合恢复器：插回 type 行后按 `content->>'typeId'` 重放关联
dictData 快照（再按各自 `label` 重放 locale 快照），不必再逐条手动恢复 data。

dictData 的单删 / 批量删（P1-12 已补 deleteMany 路由）除了快照 + 硬删原行，还按
`label` 作为 locale `key` 软删对应翻译行（同一 em），并触发 locale 缓存全量刷新。
P2-23 起 dictData 的恢复器按 `label` 重放被级联软删的 locale 快照；menu 的恢复器按同
`title` 重放 `_cascade=1` 删除的 locale 快照（关联快照重放是 best-effort，失败留存
快照并告警，不阻断主行恢复）。

### 7.3 缓存

字典**没有响应缓存**：`getByType` / `getByTypeMany` 每次都查库（`findByType` +
`findActiveByTypeId`）。所以不存在「字典变更后缓存变脏」的问题；与 lang/locale 的缓存
通道不是同一套（P2-17 只涉及 lang/locale）。

## 8. 接口表

统一响应壳 HTTP 200 + `body.code`（成功 20000）。「守卫链」只写与默认全链不同的部分；
未列出的全局守卫照常执行。`list` 端点的请求体是分页 / 过滤 / 排序 DTO。

### 8.1 user

| 方法 / 路径 | 守卫链 | 权限点 | 请求 → 响应 |
|---|---|---|---|
| POST `/system/user` | 全链 | `system:user:create` | `{ userName, status, roles }` → 用户行 + `roles` |
| GET `/system/user/:id` | 全链 | `system:user:read` | — → 用户行 + `roles_list` / `roles_count` |
| PUT `/system/user/:id` | 全链 | `system:user:update` | `{ userName, status, roles }` → 用户行 |
| DELETE `/system/user/:id` | 全链 + `@WalnutTx()` | `system:user:delete` | — → 快照行；拒自己 / safe user |
| POST `/system/user/list` | 全链 | `system:user:list` | list DTO → 裁剪行 + `roles_count` |
| GET `/system/user/me/profile` | 全链 | 无 | — → 当前用户行 + `roles_list` |
| PUT `/system/user/me/profile` | 全链 | `system:user:updateProfile` | `{ userName, nickName, avatar?, description?, gender? }` → 用户行 |
| GET `/system/user/me/security-tab2` | 全链 + `@WalnutTx()` | 无 | — → `{ totp: { status, verified }, webauthn: { status, verified } }` |
| PATCH `/system/user/me/role/switch/:roleId` | 全链 | 无 | — → `true`（effective 非 switchable → 40000） |
| PATCH `/system/user/me/roleMode/switch/:roleMode` | 全链 | 无 | 枚举 `switchable/combinable` → `true` |

### 8.2 role

| 方法 / 路径 | 守卫链 | 权限点 | 请求 → 响应 |
|---|---|---|---|
| POST `/system/role` | 全链 + `@WalnutTx()` | `system:role:create` | `{ roleName, description, order, status, menus? }` → 角色行 + `menus` |
| GET `/system/role/:id` | 全链 | `system:role:read` | — → 角色行 + `menus` + `usersCount` |
| PUT `/system/role/:id` | 全链 + `@WalnutTx()` | `system:role:update` | 同上 → 角色行（`menus` 三态见 §5.2） |
| POST `/system/role/list` | 全链 | `system:role:list` | list DTO → 行 + `usersCount` |

### 8.3 menu

| 方法 / 路径 | 守卫链 | 权限点 | 请求 → 响应 |
|---|---|---|---|
| GET `/system/menu/tree` | 全链 + **VisitorDeny**（P2-20） | **无权限点**；visitor → 40105 | — → `{ fullTree, treeWithoutTypeElement, menuActiveNamesOptions }` |
| POST `/system/menu` | 全链 | `system:menu:create` | `{ type, pid?, path?, name?, component?, title?, icon?, meta? }` → 菜单行（meta 组装） |
| GET `/system/menu/:id` | 全链 | `system:menu:read` | — → 菜单行（meta 组装） |
| PUT `/system/menu/:id` | 全链 | `system:menu:update` | 同 create 全可选 → 菜单行 |
| DELETE `/system/menu/:id?_cascade=` | 全链 + `@WalnutTx()` | `system:menu:delete` | query 0/1 → 快照行 |
| POST `/system/menu/list` | 全链 | `system:menu:list` | list DTO → 菜单行 + meta |

### 8.4 dict

| 方法 / 路径 | 守卫链 | 权限点 | 请求 → 响应 |
|---|---|---|---|
| GET `/system/dict/type/s?types=` | 全链 | **无**（登录即可读，P2-20 登记豁免） | query 数组 → `[{ type, name, dictData }]`（只回启用行/启用 data） |
| POST `/system/dict/type` | 全链 | `system:dict:type:create` | `{ type, name, status, description? }` → type 行 |
| GET `/system/dict/type/:id` | 全链 | `system:dict:type:read` | — → type 行 |
| PUT `/system/dict/type/:id` | 全链 | `system:dict:type:update` | 同 create → type 行 |
| DELETE `/system/dict/type/:id` | 全链 + `@WalnutTx()` | `system:dict:type:delete` | — → 快照行（级联软删 data） |
| POST `/system/dict/type/list` | 全链 | `system:dict:type:list` | list DTO → 行 + `dictDataCount` |
| POST `/system/dict/data` | 全链 | `system:dict:data:create` | `{ typeId, label, value, tagType, order, status, description? }` → data 行 |
| GET `/system/dict/data/:id` | 全链 | `system:dict:data:read` | — → data 行 |
| PUT `/system/dict/data/:id` | 全链 | `system:dict:data:update` | 字段全量必填（漏 `tagType` → 40099） |
| DELETE `/system/dict/data/:id` | 全链 + `@WalnutTx()` | `system:dict:data:delete` | — → 快照行 + 级联软删 locale |
| DELETE `/system/dict/data/deleteMany/:ids` | 全链 + `@WalnutTx()` | `system:dict:data:deleteMany` | 逐行同单删 → 快照行数组 |
| POST `/system/dict/data/list` | 全链 | `system:dict:data:list` | list DTO → data 行 |

### 8.5 lang / locale

| 方法 / 路径 | 守卫链 | 权限点 | 请求 → 响应 |
|---|---|---|---|
| POST `/system/lang` | 全链 | `system:lang:create` | `{ lang, description, order, status }` → lang 行；after-commit 失效 `SYS_LANG_LIST_PUBLIC` 并重算 `SYS_LANG_ID_LIST` / `SYS_LOCALE_MESSAGES`（P2-17） |
| GET `/system/lang/:id` | 全链 | `system:lang:read` | — → lang 行 + locale 计数 |
| PUT `/system/lang/:id` | 全链 | `system:lang:update` | 同 create → lang 行；同款缓存重算，`lang` 代号变更时额外清旧代号 messages 键（P2-17） |
| POST `/system/lang/list` | 全链 | `system:lang:list` | list DTO → 行 + locale 计数 + `process` |
| GET `/system/lang/list/public` | Lock/Sign/Jwt/Cap/Device Free + 响应缓存 | 无 | — → `[{ order, lang, description }]` |
| GET `/system/locale/message/:locale?cache=` | Lock/Sign/Jwt/Cap/Device/Ip Free | 无 | `cache` 缺省 1 → `{ key: value }`；未知语言回退 `en_US` |
| POST `/system/locale` | 全链 + `@WalnutTx()` | `system:locale:create` | 映射 body `{ key, <langId>: value }` → locale 行数组；刷新消息缓存 |
| GET `/system/locale/:key` | 全链 | `system:locale:read` | — → `{ <langId>: value, key }` |
| PUT `/system/locale/:id` | 全链 + `@WalnutTx()` | `system:locale:update` | 映射 body `{ key, oldKey?, <langId>: value }` → 行数组；刷新消息缓存 |
| DELETE `/system/locale/:key` | 全链 + `@WalnutTx()` | `system:locale:delete` | — → 快照行数组；刷新消息缓存 |
| DELETE `/system/locale/deleteMany/:keys` | 全链 + `@WalnutTx()` | `system:locale:deleteMany` | 逐键软删 → 快照行数组；刷新消息缓存 |
| POST `/system/locale/list` | 全链 | `system:locale:list` | list DTO → 按 key 分组的翻译行 + 进度字段 |

## 9. 已知行为注记

以下均已在 `apps/server/apps/api/test/api/DESIGN-ISSUES.md` 登记，这里只写现状与指向：

- **P1-8（已修复）**：`sys_menu` 空表时 `fullTree[0].children` / `permissionMenuTree[0].children`
  的 TypeError 已改为可选链，空表回空树 / 空 `indexMenuName`。
- **P2-8（已修复）**：dictType 删除改为同事务逐行软删 dictData，回收站可先恢复 type 再恢复 data。
- **P2-9（已修复）**：零配置默认 effective roleMode 从 switchable 改为 **combinable**；
  COMBINE 用户默认合并全部角色，scope 语义不变（GLOBAL 读 globalValue，LOCAL 读用户行）。
- **P2-10（有意设计）**：locale 翻译映射端点的宽松 ValidationPipe 是 wire 形状决定的，
  校验后移到 `LocaleParseArrayPipe`，不改行为。
- **P2-5（已修复）**：lang CRUD 经 after-commit 失效 `SYS_LANG_LIST_PUBLIC`。
- **P2-17（已修复，2026-10-29）**：lang create/update 同时重算 `SYS_LANG_ID_LIST` 与
  `SYS_LOCALE_MESSAGES`（改代号时清旧代号键）—— 新建语言后可立即写翻译。
- **P2-19（已修复，2026-10-29）**：`switchRole` 准入改按用户行值 `role_mode`，零配置下
  switchable 用户可在 junction 内的多角色间切换。
- **P2-22（已修复，2026-10-29）**：恢复用户时联动恢复 `sys_user_oauth` 绑定（快照按
  userId 重放；唯一约束冲突时跳过该行并告警，不阻断用户本体恢复）。
- **P2-23（已修复，2026-10-29）**：恢复 menu / dictData / dictType 时联动恢复级联软删的
  locale 行（dictType 另连同 dictData 快照一并重放）。
- **P3-4（裁决接受）**：`/auth/permissions` 的 `permissionMenuTree` 顶层是「首个根节点的
  children」；单根无子级时为空数组，前端菜单装配按此形状消费。
- **P3-7（裁决接受）**：「角色不删」是明确设计约束，停用走 update status、解绑走 junction。
- **P1-12（已修复）**：dictData 的 deleteMany 装饰器已接线。
- **P1-15（已修复）**：`AUTH:PERMISSIONS` 的 TTL 与 AT 有效期同秒数（修复前误乘 1000）。
- **P1-18（已修复，2026-10-28）**：根修 —— `getCoreMenus` 先按 AT userId 从
  `sys_user_role` 现查实际绑定，把 payload 的 roleIds/currentRole 过滤到 membership 内
  （COMBINE 交集；SWITCH current 失效回退绑定集首角色，空则空）—— 旧 AT 重拉不复活被移除
  角色，恢复用户后权限为空。写路径：update roles 后校正 `current_role_id`（不在新集合 →
  首角色；空 → null）并失效该用户全部设备缓存；create 与 update 口径对齐（显式
  `roles: []` → currentRole=null，roles 未给才 defaultRole，见 §3.1）。
- **P1-19（已修复，2026-10-28）**：user create / update 挂 `@WalnutTx`，主行 + junction +
  current_role 校正同事务；junction 腿失败整体回滚（api-rollback spec 双用例：
  roles=[有效, 不存在]）。
- **P2-16（已修复，2026-10-28）**：角色 update（menus / status）按 `sys_user_role` 反查
  用户并清其全部设备权限缓存；菜单失效按 F3 收窄 —— delete 全量清，update 仅
  permission/status 真变化时清，create 不清。`me/role/switch`、`me/roleMode/switch`
  仍维持「切换后需重新登录」的契约（P2-16 剩余面）。
- **P2-17（B 段新登记）**：lang 与 locale 的缓存刷新不对称。`SYS_LANG_ID_LIST` 只在
  locale 变更触发的全量刷新里写入：新建 lang 后立即给它写翻译，会因白名单缓存里没有新
  langId 而 40099，直到某次 locale 变更/删除触发刷新；lang update 改语言代号也不重算
  `SYS_LOCALE_MESSAGES`。
- **P2-18（已修复：用户外围联动；junction 部分仍登记）**：软删恢复不恢复 junction。
  menu / user 等行删除时 junction 由 FK CASCADE 清掉且不进 `sys_deleted` 快照；恢复菜单后
  角色授权为空、恢复用户后 `roles_list` 为空，权限按空 membership 计算（P1-18 根修）、
  重新登录被拒（需重新授权）。2026-10-28 批 D 已给用户删除补 identity/preference/
  user_device/mfa/lock 五表快照并在恢复时联动重放；回收站 read/deleteMany 的 content
  在 DTO 层遮蔽凭据密文（F2）；junction 快照方案仍未落地。
- **P2-19（B 段新登记）**：effective roleMode 与 AT payload / 守卫判据两层不一致。
  零配置默认（GLOBAL/combinable）下 `switchRole` 对**所有用户**恒 40000（effective 是
  combinable），而 payload 里的 `roleMode` 仍是用户行的 `switchable`，守卫的 root/visitor
  短路与前端角色切换入口都按行值工作；`roleMode/switch` 改行值也不会改变 effective。
- **P2-20（已修复，2026-10-29）**：`GET /system/menu/tree` 选型为 **visitor 显式拒绝**
  （`WalnutAdminGuardVisitorDeny` → 40105），不挂 `system:menu:*`（该端点是菜单管理/角色
  授权视图的数据源，普通非 root 用户可能被授予管理权；而 permission.guard 的 visitor
  白名单本就放行 `:list`/`:read`）。`GET /system/dict/type/s` 登记为**登录即可读**的公共
  字典通道（只回启用子集，非管理面）。普通非 root 用户仍可读全量菜单树（含 permission
  串）—— 菜单管理功能的必要输入，残余风险已在 DESIGN-ISSUES 登记。
  `ENDPOINTS.md` 的 dict 权限串同步更正为 `system:dict:type:*` / `system:dict:data:*`。
- **P3-18（B 段新登记）—— 已修复 2026-10-29**：`fullTree` / `permissionMenuTree` /
  `permissionRouteTree` 改为「全部根 children 拼接」（单根 wire 不变），repo 新增
  `findAllRootMenus`（按 order + createdAt 排序）；双根用例见 `menu.api-spec.ts`。
- **P3-19（B 段新登记）**：`ENDPOINTS.md` 把 `PUT /system/user/me/profile` 的权限点
  登记为 `me:profile:update`，实际 controller 常量是 `system:user:updateProfile`。
- **P3-20（B 段新登记）—— 已修复 2026-10-29**：locale 的映射 body 若不含任何 langId uuid
  键（如 `{}`），`LocalePayloadTransformPipe` 现在直接抛受控 40099（此前空数组落 service
  → TypeError → 50000）。
