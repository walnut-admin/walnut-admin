/* eslint-disable no-restricted-syntax -- 恢复器是系统通道：locale 级联恢复按快照重放原行，不做请求用户维度的行级过滤（与 user.recoverer 同口径）。 */
import type { EntityManager, EntityTarget, ObjectLiteral } from 'typeorm'
import type { IWalnutPgSnapshotRecoverer } from './recover-registry'
import { Logger } from '@nestjs/common'
import { WalnutModelName } from '@walnut-server/db'
import { SysDictDataEntity } from '@/modules/system/dict/dictData/entity/dict-data.entity'
import { SysDictTypeEntity } from '@/modules/system/dict/dictType/entity/dict-type.entity'
import { SysLocaleEntity } from '@/modules/system/locale/entity/locale.entity'
import { SysMenuEntity } from '@/modules/system/menu/entity/menu.entity'
import { SysDeletedEntity } from '../entity/deleted.entity'

/**
 * 级联软删的联动恢复器（P2-23，2026-10-29）。
 *
 * 正向删除（menu `_cascade=1`、dictData 单删/批量删、dictType 删除）都会把 locale 行
 * （以及 dictType 下的 dictData 行）做成 `sys_deleted` 快照并硬删原行。通用恢复器只
 * 插回主行 —— 翻译留在回收站，前端按 key 取不到文案。这里按「主行 → 关联快照」逐层
 * 重放，写出顺序保证 FK 依赖（type → data → locale）。
 *
 * 关联键（按实际数据形态）：
 * - locale 行没有 menuId/typeId 列，级联删除本身按 `key` 匹配 —— menu 用 `title`、
 *   dictData 用 `label` 作为 locale 的 `key` 反查；
 * - dictData 用 `typeId` 反查（content jsonb 里的外键列）。
 *
 * 失败语义：所有关联重放都是 best-effort（savepoint 隔离，失败留存快照并告警）——
 * 主行恢复不能因为「翻译行所属语言已删」「外部账号已重新绑定」这类外部依赖整体回滚。
 * 同一被删行有多份历史快照时只重放最新一份（与 user recoverer 同口径），其余留档。
 */
const logger = new Logger('WalnutCascadeSnapshotRecoverer')

interface IReplaySnapshotOptions<T extends ObjectLiteral> {
  modelName: string
  entityTarget: EntityTarget<T>
  /** content jsonb 里的关联键列名（只接受本文件内的字面量，不来自外部输入） */
  whereColumn: string
  whereValue: string
  /** 单行插回成功后的后续联动（如 dictData 恢复后重放其 locale 行） */
  onRestored?: (content: Record<string, unknown>) => Promise<void>
}

async function replaySnapshots<T extends ObjectLiteral>(
  em: EntityManager,
  options: IReplaySnapshotOptions<T>,
): Promise<void> {
  const deletedRepository = em.getRepository(SysDeletedEntity)

  const snapshots = await deletedRepository.createQueryBuilder('deleted')
    .where('deleted.modelName = :modelName', { modelName: options.modelName })
    .andWhere(`deleted.content ->> '${options.whereColumn}' = :whereValue`, { whereValue: options.whereValue })
    .orderBy('deleted.deletedAt', 'DESC')
    .getMany()

  const restoredDeletedIds = new Set<string>()

  for (const snapshot of snapshots) {
    if (restoredDeletedIds.has(snapshot.deletedId)) {
      continue
    }
    restoredDeletedIds.add(snapshot.deletedId)

    await em.query('SAVEPOINT walnut_cascade_recover')

    try {
      await em.getRepository(options.entityTarget).insert(snapshot.content as never)
      await deletedRepository.delete({ id: snapshot.id })
      await em.query('RELEASE SAVEPOINT walnut_cascade_recover')
    }
    catch (error) {
      await em.query('ROLLBACK TO SAVEPOINT walnut_cascade_recover')
      logger.warn(
        `cascade recover skipped ${options.modelName} snapshot ${snapshot.id}: ${error instanceof Error ? error.message : String(error)}`,
      )
      continue
    }

    if (options.onRestored !== undefined) {
      await options.onRestored(snapshot.content)
    }
  }
}

/** 按 locale `key` 重放翻译行（menu.title / dictData.label 的级联腿共用） */
async function replayLocaleSnapshotsByKey(em: EntityManager, key: string) {
  await replaySnapshots(em, {
    modelName: WalnutModelName.SYS_LOCALE,
    entityTarget: SysLocaleEntity,
    whereColumn: 'key',
    whereValue: key,
  })
}

function readStringField(content: Record<string, unknown>, field: string): string | null {
  const value = content[field]
  return typeof value === 'string' && value !== '' ? value : null
}

/**
 * `sys_menu` 组合恢复器：插回菜单行，并按同 `title` 重放 `_cascade=1` 删除的 locale 行。
 */
export function createWalnutMenuSnapshotRecoverer(): IWalnutPgSnapshotRecoverer {
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

/**
 * `sys_dict_data` 组合恢复器：插回数据行，并按同 `label` 重放级联删除的 locale 行。
 */
export function createWalnutDictDataSnapshotRecoverer(): IWalnutPgSnapshotRecoverer {
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

/**
 * `sys_dict_type` 组合恢复器（P2-8 的 dictData 快照 + P2-23 的 locale 快照）：
 * 插回 type 行后，按 `typeId` 重放关联 dictData 快照；每个 data 行再按其 `label`
 * 重放 locale 行。写入顺序保证 `fk_dict_data_type` 与 `fk_locale_lang` 的依赖。
 */
export function createWalnutDictTypeSnapshotRecoverer(): IWalnutPgSnapshotRecoverer {
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
