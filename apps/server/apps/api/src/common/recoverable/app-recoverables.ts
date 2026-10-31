import type { WalnutAdminRecoverableRegistry } from '@walnut-server/repository'
import { registerAppDemoRecoverable } from '@/modules/app/demo/demo.recoverable'
import { registerAppErrorRecoverable } from '@/modules/app/error/error.recoverable'
import { registerAppKeyRecoverable } from '@/modules/app/key/key.recoverable'
import { registerAppMonitorUserRecoverable } from '@/modules/app/monitor/user/monitor-user.recoverable'
import { registerAppSettingRecoverable } from '@/modules/app/setting/setting.recoverable'
import { registerAuthRefreshTokenRecoverable } from '@/modules/auth/modules/refresh/refresh.recoverable'
import { registerSharedAreaRecoverable } from '@/modules/shared/area/area.recoverable'

/**
 * app 侧三个域（app / auth / shared）的恢复器登记汇总（libs 解耦批 7）。
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
