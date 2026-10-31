/**
 * 身份内核 barrel（libs 解耦批 6）。
 *
 * 七个身份栈子目录（user / user_identity / user_oauth / user_mfa / user_device /
 * user_lock / user_preference）的 module / service / repository / 实体 / DTO / 常量
 * 全量导出 —— 身份栈被 auth / security / system 其余 / app monitor / techniques
 * 全仓消费，barrel 是唯一入口。
 *
 * 反向依赖底线：本 lib 不 import 任何 `@/`（apps/api/src）路径。内核需要的外界能力
 * 见 `identity.ports.ts`（OTP / MFA post-verification / signout / 在线监控 / socket
 * 通知 / 设备注册表 / 数据权限失效），实现与绑定留在 app 的组合根。
 */
export * from './identity.module'
export * from './identity.ports'

export * from './shared/base.model'
export * from './shared/device-location'
export * from './shared/sys-role.entity'

export * from './user'
export * from './user_device'
export * from './user_identity'
export * from './user_lock'
export * from './user_mfa'
export * from './user_oauth'
export * from './user_preference'
