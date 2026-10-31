import type { IWalnutAdminRecoverableRecoverer, WalnutAdminRecoverableRegistry } from '@walnut-server/repository'
import type { EntityManager } from 'typeorm'
import { WalnutModelName } from '@walnut-server/db'
import { createWalnutAdminRecoverableRegistrar } from '@walnut-server/repository'
import { readStringField, replayLocaleSnapshotsByKey, replaySnapshots } from '../../../deleted/repo/cascade-snapshot.replayer'
import { SysDictDataEntity } from '../../dictData/entity/dict-data.entity'
import { SysDictTypeEntity } from '../entity/dict-type.entity'

/**
 * `sys_dict_type` 组合恢复器（P2-8 的 dictData 快照 + P2-23 的 locale 快照）；
 * 批 7 拆到 dictType 域。
 *
 * 插回 type 行后，按 `typeId` 重放关联 dictData 快照；每个 data 行再按其 `label`
 * 重放 locale 行。写入顺序保证 `fk_dict_data_type` 与 `fk_locale_lang` 的依赖。
 */
export function createWalnutDictTypeSnapshotRecoverer(): IWalnutAdminRecoverableRecoverer {
  return {
    recover: async (content: Record<string, unknown>, em: EntityManager) => {
      await em.getRepository(SysDictTypeEntity).insert(content)

      const typeId = readStringField(content, 'id')
      if (typeId === null) {
        return
      }

      await replaySnapshots(em, {
        modelName: WalnutModelName.SYS_DICT_DATA,
        entityTarget: SysDictDataEntity,
        whereColumn: 'typeId',
        whereValue: typeId,
        onRestored: async (dataContent) => {
          const label = readStringField(dataContent, 'label')
          if (label !== null) {
            await replayLocaleSnapshotsByKey(em, label)
          }
        },
      })
    },
  }
}

export function registerSysDictTypeRecoverable(registry: WalnutAdminRecoverableRegistry): void {
  registry.register({
    modelName: WalnutModelName.SYS_DICT_TYPE,
    entityTarget: SysDictTypeEntity,
    recoverer: createWalnutDictTypeSnapshotRecoverer(),
  })
}

export const sysDictTypeRecoverableProvider = createWalnutAdminRecoverableRegistrar(registerSysDictTypeRecoverable)
