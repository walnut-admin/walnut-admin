import type { WalnutAdminRecoverableRegistry } from '@walnut-server/repository'
import { registerAppDemoRecoverable, registerAppErrorRecoverable, registerAppKeyRecoverable, registerAppMonitorUserRecoverable, registerAppSettingRecoverable, registerSharedAreaRecoverable } from '@walnut-server/app-domain'
import { registerAuthRefreshTokenRecoverable } from '@walnut-server/auth'

/**
 * app 侧三个域（app / auth / shared）的恢复器登记汇总（libs 解耦批 7；
 * 批 9 起 app / shared 的实体与登记器都在 `@walnut-server/app-domain`）。
 *
 * 运行期由各域自己的 Nest module 调各自的 `registerXxxRecoverable`（薄 factory
 * provider）；本汇总函数只给 `dto-entity.drift.spec` 用 —— 它在纯注册表实例上重放
 * 「运行期登记」的同一份逻辑，再与 DTO 清单对账（不是静态扫源码）。
 */
export function registerAppRecoverables(registry: WalnutAdminRecoverableRegistry): void {
  registerAppDemoRecoverable(registry)
  registerAppErrorRecoverable(registry)
  registerAppKeyRecoverable(registry)
  registerAppMonitorUserRecoverable(registry)
  registerAppSettingRecoverable(registry)
  registerAuthRefreshTokenRecoverable(registry)
  registerSharedAreaRecoverable(registry)
}
