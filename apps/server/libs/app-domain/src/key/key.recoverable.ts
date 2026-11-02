import type { WalnutAdminRecoverableRegistry } from '@walnut-server/repository'
import { WalnutModelName } from '@walnut-server/db'
import { createWalnutAdminRecoverableRegistrar, createWalnutAdminSnapshotRecoverer } from '@walnut-server/repository'
import { AppKeyEntity } from './entity/key.entity'

/**
 * AppKeyEntity 的回收站恢复器登记（libs 解耦批 7）—— 实体在本域，由本模块装配期登记；
 * 回收站（libs/system）不再 import 本域的实体。
 */
export function registerAppKeyRecoverable(registry: WalnutAdminRecoverableRegistry): void {
  registry.register({
    modelName: WalnutModelName.APP_KEY,
    entityTarget: AppKeyEntity,
    recoverer: createWalnutAdminSnapshotRecoverer(AppKeyEntity),
  })
}

export const appKeyRecoverableProvider = createWalnutAdminRecoverableRegistrar(registerAppKeyRecoverable)
