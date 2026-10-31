/**
 * security 域 barrel（libs 解耦批 8）。
 *
 * cap / risk / sensitive / sign 四个子目录的 module / service / config / DTO 全量导出
 * （rsa 已于批 5 独立为 `@walnut-server/rsa`，由 `SysSecurityModule` 聚合进来）。
 * controller 不在 lib：它们依赖 app 的 guard / param decorator / log decorator 与
 * `@walnut-server/auth` 的 OTP guard，放进 lib 会形成反向依赖或 lib 环。
 *
 * 依赖方向：本 lib → `@walnut-server/auth`（sensitive 的 OTP 校验）。auth 对 risk 的
 * 登出后清理走 `auth.ports.ts` 的端口 token，由 risk.module 绑定实现 —— 不成环。
 */
export * from './cap/cap.dto'
export * from './cap/cap.module'
export * from './cap/cap.service'
export * from './cap/cap.setting.service'

export * from './risk/modules/challenge.service'
export * from './risk/modules/device.service'
export * from './risk/modules/failedLogin.service'
export * from './risk/modules/ip.service'
export * from './risk/modules/location.service'
export * from './risk/modules/rate.service'
export * from './risk/modules/user.service'
export * from './risk/modules/user_device.service'
export * from './risk/risk.config.service'
export * from './risk/risk.module'
export * from './risk/risk.service'

export * from './security.module'

export * from './sensitive/sensitive.config'
export * from './sensitive/sensitive.const'
export * from './sensitive/sensitive.dto'
export * from './sensitive/sensitive.module'
export * from './sensitive/sensitive.service'
export * from './sensitive/sensitive.type'

export * from './sign/sign.dto'
export * from './sign/sign.module'
export * from './sign/sign.service'
