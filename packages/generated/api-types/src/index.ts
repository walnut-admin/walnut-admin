/**
 * OpenAPI 生成类型的消费入口 —— 生成物 `./schema.d.ts` 由 `pnpm generate`
 * （openapi-typescript）从 `apps/server/openapi.json` 产出，**不许手改**；
 * 本文件只做 re-export 与「模块别名」。
 *
 * 别名命名对齐 admin 侧原 `IModels.X` / `IResponseData.X.Y` 名称（OpenAPI codegen
 * 二期全模块替换）：逐名平移，`X` 即 server Safe/响应 DTO 的 wire 真源。
 *
 * 一致性：prepush 的「openapi 一致性」段跑 导出 → 生成 → `git diff --exit-code`，
 * server DTO 漂移会在这里变红。
 */
import type { components } from './schema'

export type { components, paths } from './schema'

/**
 * Safe 响应别名统一加 `& { id: string }`：swagger 里 id 标成可选（同一个 DTO 类兼任
 * list 查询过滤，那里 id 可选），但 Safe 响应经 ClassSerializer **必含** id（uuid）——
 * 这是响应侧恒真的事实，同时让 `BaseAPI<T extends { id: string }>` 的泛型约束对生成
 * 类型继续成立。生成类型的 `createdAt`/`updatedAt` 是 string（ISO），与旧手写镜像的
 * Date 形态不同 —— 替换后以生成为准。
 */

// ---------------------------------------------------------------- system menu

/**
 * server `SysMenuDTOSafe`（menu 模块 Safe DTO）的生成别名 —— admin 侧 menu 链路的 wire 真源。
 */
export type SystemMenu = components['schemas']['SysMenuDTOSafe'] & { id: string }

/**
 * server `SysMenuDTOTree`（menu 树节点：Safe 剔 pid/createdAt/updatedAt + children）的生成别名。
 * 生成形态自带 `children?: SystemMenuTree[]`，与前端 `TreeNodeItem<T>` 的包装同构，
 * tree 接口响应直接可用。
 */
export type SystemMenuTree = components['schemas']['SysMenuDTOTree']

/** menu meta（SysMenuDTOSafe.meta 引用的子对象，生成侧全字段必填）。 */
export type SystemMenuMeta = components['schemas']['SysMenuMetaDTOBasePartial']

/** `GET /system/menu/tree` 响应载荷（fullTree / treeWithoutTypeElement / menuActiveNamesOptions）。 */
export type SystemMenuTreeResponse = components['schemas']['SysMenuDTOTreeResponse']

// ---------------------------------------------------------------- system role

export type SystemRole = components['schemas']['SysRoleDTOSafe'] & { id: string }

// ---------------------------------------------------------------- system dept

/**
 * server `SysDeptDTOSafe`（dept 模块 Safe DTO）的生成别名 —— 部门平表行
 * （数据权限二期批 2 起 admin 的部门树选择器消费）。
 */
export type SystemDept = components['schemas']['SysDeptDTOSafe'] & { id: string }

/**
 * `GET /system/dept/tree` 的树节点（server `SysDeptDTOTree` 自带递归 children），
 * 可直接作为 `Base:TreeSelect` 的 options。
 */
export type SystemDeptTree = components['schemas']['SysDeptDTOTree']

// ---------------------------------------------------------------- system user

export type SystemUser = components['schemas']['SysUserDTOSafe'] & { id: string }

/**
 * `GET /system/user/{id}`（以及 `/system/device/{id}/current-active-user`）响应。
 * 生成形态与 SysUserDTOSafe 完全一致（server 就是同一 DTO 类两种装饰），复用 SystemUser。
 */
export type SystemUserReadResponse = SystemUser

/**
 * user identity 的类型/用途 —— admin 只暴露 phoneNumber / emailAddress 两条路径
 * （生成 SysUserIdentityDTO.type 还含 idCard/password，是 server 实体全集，非 admin UI 面）。
 */
export type SystemUserIdentityType = 'phoneNumber' | 'emailAddress'
export type SystemUserIdentityPurpose = 'login' | 'security'

/** `POST /system/user/identity/list` 行形态（wire 安全字段子集：value/valueHash 密文面永不出接口），admin 暂无直连消费，铺齐备用。 */
export type SystemUserIdentity = components['schemas']['SysUserIdentityListItemDTO']

// ------------------------------------------------------------ system user device

/** `GET /system/user/device/list` 行形态（自定义聚合 DTO，无 id，rowKey 用 deviceId）。 */
export type SystemUserDeviceListItem = components['schemas']['SysUserDeviceListItemDTO']

/** `GET /system/user/device/list` 响应载荷（data + total）。 */
export type SystemUserDeviceListResponse = components['schemas']['SysUserDeviceListDTO']

// ---------------------------------------------------------------- system lock

/**
 * `GET /system/user/lock/read` 响应（SysUserLockPreferenceDTO：lock 偏好 + device.locked 交集）。
 * server 该端点装饰曾谎报 `primitive: 'boolean'`（真实返回是本对象），2026-10-28 已按
 * codegen 二期例外流程改为 `DTO: SysUserLockPreferenceDTO` 并重新 export/generate。
 */
export type SystemUserLockStatus = components['schemas']['SysUserLockPreferenceDTO']

// ---------------------------------------------------------------- system device

export type SystemDevice = components['schemas']['SysDeviceDTOSafe'] & { id: string }

/**
 * `GET /system/device/{id}/history-users` 行形态（userName/nickName/id/lastActiveAt 摘要）。
 * P3-11 已补 `isArray: true`：端点响应 data 在生成 schema 里就是本类型的数组。
 */
export type SystemDeviceHistoryUser = components['schemas']['SysDeviceDTOHistoryUsersResponse'] & { id: string }

/**
 * `POST /system/device/initial` 响应 —— 设备注册回显的公开面（codegen 收尾批校正）：
 * `deviceId` 恒有，经纬度 / countryCode 来自 IP 定位（本地 IP 时缺省），旧别名曾错指
 * 全量 `SystemDevice`（Safe 形态），与实际 wire 不符。
 */
export type SystemDeviceInitialResponse = components['schemas']['SysDeviceDTOInitialResponse']

// ---------------------------------------------------------------- system lang / locale
// list 行的 process 已由 server 文档化（P3-10：声明在 SysLangDTO / SysLocaleDTO 基类，
// required: false）—— 生成 schema 自带该键，不再手工补声明。lang 的 process 可空
// （零 locale 时 finished / total 在 JS 侧为 NaN，JSON 序列化为 null）；locale 的
// process 是 0..1 小数（admin 列表 × 100 展示）。

export type SystemLang = components['schemas']['SysLangDTO'] & { id: string }

/** 列表行是**按 key 分组**的聚合结果：`groupKey` 是分组键（= key），不是主键 id（D16②）。 */
export type SystemLocale = components['schemas']['SysLocaleDTO'] & { groupKey: string }

/** `GET /system/lang/list/public` 行形态（order / lang / description 三列 raw 投影）。 */
export type SystemLangPublicListItem = components['schemas']['SysLangDTOListPublicResponse']

// ---------------------------------------------------------------- system dict

export type SystemDictType = components['schemas']['SysDictTypeDTOSafe'] & { id: string }

export type SystemDictData = components['schemas']['SysDictDataDTOSafe'] & { id: string }

/** dict type 携带 dictData 的聚合响应（`GET /system/dict/type/s`，MapDictValue）。 */
export type SystemDictTypeWithDictData = components['schemas']['SysDictTypeDTOWithDictDataResponse']

/** dict type 聚合响应里的 dictData 行（无 createdAt/updatedAt/typeId 的瘦身形态）。 */
export type SystemDictDataPopulated = components['schemas']['SysDictDataDTOPopulatedDictData']

// ---------------------------------------------------------------- system log

export type SystemLogOperate = components['schemas']['SysLogOperateDTO'] & { id: string }

/** `GET /system/log/operate/{id}/snapshot` 响应（前后镜像对象）。 */
export type SystemLogOperateSnapshot = components['schemas']['SysLogOperateDTOSnapshotResponse']

export type SystemLogAuth = components['schemas']['SysLogAuthDTO'] & { id: string }

// ---------------------------------------------------------------- system deleted

export type SystemDeleted = components['schemas']['SysDeletedDTOSafe'] & { id: string }

// ---------------------------------------------------------------- app

export type AppSettings = components['schemas']['AppSettingDTOSafe'] & { id: string }

/**
 * app logger 行。注意：`AppLoggerDTO` 本身没有 id（server 从日志文件列表组装，
 * admin CRUD 用 filePath 做 rowKey）—— 这里的 `& { id: string }` 是为满足 BaseAPI
 * 泛型约束的历史虚构（与旧 IModels.AppLogger extends IModels.Base 同一档），已登记
 * DESIGN-ISSUES；server 若补真实 id 可直接摘掉。
 */
export type AppLogger = components['schemas']['AppLoggerDTO'] & { id: string }

/**
 * app monitor cache 行。同 AppLogger：`AppMonitorCacheDTO` 无 id（rowKey 用 key），
 * `& { id: string }` 是约束性虚构，见 DESIGN-ISSUES。
 */
export type AppMonitorCache = components['schemas']['AppMonitorCacheDTO'] & { id: string }

export type AppMonitorUser = components['schemas']['AppMonitorUserDTO'] & { id: string }

/** `GET /app/logger/{logType}/{fileName}?page=n` 响应（30 行/页，与 list 行不同形）。 */
export type AppLoggerReadResponse = components['schemas']['AppLoggerReadResponseDTO']

/** `GET /deps` 响应（server package.json 的 dependencies / devDependencies）。 */
export type AppBackendDeps = components['schemas']['AppBackendDepsResponseDTO']

/**
 * `GET /app/key/current/{type}` 响应 —— 按 type 二选一：RSA_PAIR 只含 `publicKeyPem`，
 * AES_KEY_URL 只含 `keyB64`（swagger 无法按路由参数分叉，两个字段在生成侧都是 optional）。
 */
export type AppKeyCurrent = components['schemas']['AppKeyCurrentResponseDTO']

// app monitor/server 八个端点（systeminformation 子集，server DTO 逐字段投影）

export type AppMonitorServerCpu = components['schemas']['AppMonitorServerDTOCPU']

export type AppMonitorServerMem = components['schemas']['AppMonitorServerDTOMem']

export type AppMonitorServerOs = components['schemas']['AppMonitorServerDTOOS']

export type AppMonitorServerSystem = components['schemas']['AppMonitorServerDTOSystem']

export type AppMonitorServerDisk = components['schemas']['AppMonitorServerDTODisk']

export type AppMonitorServerBattery = components['schemas']['AppMonitorServerDTOBattery']

export type AppMonitorServerTime = components['schemas']['AppMonitorServerDTOTime']

export type AppMonitorServerNetwork = components['schemas']['AppMonitorServerDTONetwork']

// ---------------------------------------------------------------- shared

export type SharedArea = components['schemas']['SharedAreaDTO']

/** `GET /shared/ali/sts` 响应（三敏感字段是 RSA 信封字符串）。 */
export type SharedAliStsToken = components['schemas']['SharedAliOSSDTO']

// ---------------------------------------------------------------- auth / me

/** 登录/刷新/MFA 验证后的 token 载荷（server AuthSuccessDTO）。 */
export type AuthTokenPayload = components['schemas']['AuthSuccessDTO']

/** `GET /auth/mfa/status` 响应（可用 MFA 方式列表）。 */
export type AuthMfaAvailableMethod = components['schemas']['AuthMfaStatusDTO']

/** totp 生成响应（secret + qrCode）。 */
export type AuthMfaTotpGenerate = components['schemas']['SysUserMfaGenerateTotpResponseDTO']

/** totp 绑定响应（backupCodes）。 */
export type AuthMfaTotpBind = components['schemas']['SysUserMfaBindTotpResponseDTO']

/**
 * `GET /system/user/identity/status/{purpose}` 响应（password/phoneNumber/emailAddress 三段状态）。
 * 注意 server 字段名是 `lastChanged`（旧手写镜像曾写 `lastChangedAt`，属镜像漂移，已纠正）。
 */
export type MeSecurityTab1Status = components['schemas']['SysUserIdentityStatusResponseDTO']

/**
 * `GET /system/user/me/security-tab2` 响应（totp / webauthn 两种 MFA 的总状态）。
 * P3-12 已补 server DTO（`SysUserMeSecurityTab2ResponseDTO`），不再走手写兜底形状。
 */
export type MeSecurityTab2Status = components['schemas']['SysUserMeSecurityTab2ResponseDTO']

/** `GET /auth/keys` 响应（`B` 是百度 AK 的 RSA 信封字符串）。 */
export type AuthSecretKeys = components['schemas']['AuthSecretKeysResponseDTO']

/** `POST /security/sign/aes-key` 响应（`aesKey` 是 RSA 信封字符串 + hkdfInfo）。 */
export type SecuritySignAesKey = components['schemas']['SecuritySignSessionKeyResponseDTO']

// ---------------------------------------------------------------- auth / mfa webauthn

/**
 * `POST /system/user/mfa/webauthn/register/options` 响应。`options` 的生成形态按
 * @simplewebauthn/server 的 PublicKeyCredentialCreationOptionsJSON 逐字段文档化，
 * 与 @simplewebauthn/browser 的 `startRegistration({ optionsJSON })` 入参结构等价。
 */
export type AuthMfaWebauthnRegisterOptions = components['schemas']['SysUserMfaWebauthnRegisterResponseDTO']

/**
 * `POST /system/user/mfa/webauthn/authenticate/options` 响应。`options` 的生成形态按
 * @simplewebauthn/server 的 PublicKeyCredentialRequestOptionsJSON 逐字段文档化，
 * 与 @simplewebauthn/browser 的 `startAuthentication({ optionsJSON })` 入参结构等价。
 */
export type AuthMfaWebauthnAuthenticateOptions = components['schemas']['SysUserMfaWebauthnAuthenticateOptionsDTO']
