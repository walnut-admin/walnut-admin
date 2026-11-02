import type { WalnutAdminRecoverableRegistry } from '@walnut-server/repository'
import { registerSysDeptRecoverable } from './dept/dept.recoverer'
import { registerSysDeviceRecoverable } from './device/device.recoverer'
import { registerSysDictDataRecoverable } from './dict/dictData/repo/dict-data.recoverer'
import { registerSysDictTypeRecoverable } from './dict/dictType/repo/dict-type.recoverer'
import { registerSysEmployeeRecoverable } from './employee/employee.recoverer'
import { registerSysLangRecoverable } from './lang/lang.recoverer'
import { registerSysLocaleRecoverable } from './locale/locale.recoverer'
import { registerSysLogAuthRecoverable } from './logs/auth/log.auth.recoverer'
import { registerSysLogOperateRecoverable } from './logs/operate/log.operate.recoverer'
import { registerSysMenuRecoverable } from './menu/repo/menu.recoverer'
import { registerSysPostRecoverable } from './post/post.recoverer'
import { registerSysRoleRecoverable } from './role/repo/role.recoverer'

/**
 * system 域（12 个实体）的恢复器登记汇总（libs 解耦批 7）。
 *
 * 运行期由各子模块自己的 Nest module 调各自的 `registerXxxRecoverable`（薄 factory
 * provider）；本汇总函数只给 `dto-entity.drift.spec` 用 —— 它在纯注册表实例上重放
 * 「运行期登记」的同一份逻辑，再与 DTO 清单对账（不是静态扫源码）。
 */
export function registerSystemRecoverables(registry: WalnutAdminRecoverableRegistry): void {
  registerSysRoleRecoverable(registry)
  registerSysMenuRecoverable(registry)
  registerSysDeptRecoverable(registry)
  registerSysPostRecoverable(registry)
  registerSysEmployeeRecoverable(registry)
  registerSysLangRecoverable(registry)
  registerSysLocaleRecoverable(registry)
  registerSysDeviceRecoverable(registry)
  registerSysLogAuthRecoverable(registry)
  registerSysLogOperateRecoverable(registry)
  registerSysDictDataRecoverable(registry)
  registerSysDictTypeRecoverable(registry)
}
