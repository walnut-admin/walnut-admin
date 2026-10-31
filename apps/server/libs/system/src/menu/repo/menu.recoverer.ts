import type { IWalnutAdminRecoverableRecoverer, WalnutAdminRecoverableRegistry } from '@walnut-server/repository'
import type { EntityManager } from 'typeorm'
import { WalnutModelName } from '@walnut-server/db'
import { createWalnutAdminRecoverableRegistrar } from '@walnut-server/repository'
import { readStringField, replayLocaleSnapshotsByKey } from '../../deleted/repo/cascade-snapshot.replayer'
import { SysMenuEntity } from '../entity/menu.entity'

/**
 * `sys_menu` 组合恢复器（P2-23）；批 7 从 deleted/repo/locale-cascade.recoverer 拆到
 * menu 域 —— 实体在哪个域就由哪个域登记。
 *
 * 插回菜单行，并按同 `title` 重放 `_cascade=1` 删除的 locale 行。
 */
export function createWalnutMenuSnapshotRecoverer(): IWalnutAdminRecoverableRecoverer {
  return {
    recover: async (content: Record<string, unknown>, em: EntityManager) => {
      await em.getRepository(SysMenuEntity).insert(content)

      const title = readStringField(content, 'title')
      if (title !== null) {
        await replayLocaleSnapshotsByKey(em, title)
      }
    },
  }
}

export function registerSysMenuRecoverable(registry: WalnutAdminRecoverableRegistry): void {
  registry.register({
    modelName: WalnutModelName.SYS_MENU,
    entityTarget: SysMenuEntity,
    recoverer: createWalnutMenuSnapshotRecoverer(),
  })
}

export const sysMenuRecoverableProvider = createWalnutAdminRecoverableRegistrar(registerSysMenuRecoverable)
