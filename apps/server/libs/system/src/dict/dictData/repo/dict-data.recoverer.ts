import type { IWalnutAdminRecoverableRecoverer, WalnutAdminRecoverableRegistry } from '@walnut-server/repository'
import type { EntityManager } from 'typeorm'
import { WalnutModelName } from '@walnut-server/db'
import { createWalnutAdminRecoverableRegistrar } from '@walnut-server/repository'
import { readStringField, replayLocaleSnapshotsByKey } from '../../../deleted/repo/cascade-snapshot.replayer'
import { SysDictDataEntity } from '../entity/dict-data.entity'

/**
 * `sys_dict_data` 组合恢复器（P2-23）；批 7 拆到 dictData 域。
 *
 * 插回数据行，并按同 `label` 重放级联删除的 locale 行。
 */
export function createWalnutDictDataSnapshotRecoverer(): IWalnutAdminRecoverableRecoverer {
  return {
    recover: async (content: Record<string, unknown>, em: EntityManager) => {
      await em.getRepository(SysDictDataEntity).insert(content)

      const label = readStringField(content, 'label')
      if (label !== null) {
        await replayLocaleSnapshotsByKey(em, label)
      }
    },
  }
}

export function registerSysDictDataRecoverable(registry: WalnutAdminRecoverableRegistry): void {
  registry.register({
    modelName: WalnutModelName.SYS_DICT_DATA,
    entityTarget: SysDictDataEntity,
    recoverer: createWalnutDictDataSnapshotRecoverer(),
  })
}

export const sysDictDataRecoverableProvider = createWalnutAdminRecoverableRegistrar(registerSysDictDataRecoverable)
