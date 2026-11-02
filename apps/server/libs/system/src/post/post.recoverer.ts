import type { WalnutAdminRecoverableRegistry } from '@walnut-server/repository'
import { WalnutModelName } from '@walnut-server/db'
import { createWalnutAdminRecoverableRegistrar, createWalnutAdminSnapshotRecoverer } from '@walnut-server/repository'
import { SysPostEntity } from './entity/post.entity'

/**
 * sys_post 的回收站恢复器登记（libs 解耦批 7）—— 通用恢复器：快照行原样插回。
 */
export function registerSysPostRecoverable(registry: WalnutAdminRecoverableRegistry): void {
  registry.register({
    modelName: WalnutModelName.SYS_POST,
    entityTarget: SysPostEntity,
    recoverer: createWalnutAdminSnapshotRecoverer(SysPostEntity),
  })
}

export const sysPostRecoverableProvider = createWalnutAdminRecoverableRegistrar(registerSysPostRecoverable)
