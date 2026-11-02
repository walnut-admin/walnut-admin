/* eslint-disable no-restricted-syntax -- 恢复器是系统通道：locale 级联恢复按快照重放原行，不做请求用户维度的行级过滤（与 user.recoverer 同口径）。 */
import type { EntityManager, EntityTarget, ObjectLiteral } from 'typeorm'
import { Logger } from '@nestjs/common'
import { WalnutModelName } from '@walnut-server/db'
import { SysDeletedEntity } from '@walnut-server/repository'
import { SysLocaleEntity } from '../../locale/entity/locale.entity'

/**
 * 级联软删快照的通用重放腿（P2-23，2026-10-29；批 7 从 locale-cascade.recoverer 拆出）。
 *
 * 正向删除（menu `_cascade=1`、dictData 单删/批量删、dictType 删除）都会把 locale 行
 * （以及 dictType 下的 dictData 行）做成 `sys_deleted` 快照并硬删原行。通用恢复器只
 * 插回主行 —— 翻译留在回收站，前端按 key 取不到文案。各域的组合恢复器（menu /
 * dictData / dictType）用本文件的重放腿按「主行 → 关联快照」逐层重放。
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

export interface IReplaySnapshotOptions<T extends ObjectLiteral> {
  modelName: string
  entityTarget: EntityTarget<T>
  /** content jsonb 里的关联键列名（只接受本文件内的字面量，不来自外部输入） */
  whereColumn: string
  whereValue: string
  /** 单行插回成功后的后续联动（如 dictData 恢复后重放其 locale 行） */
  onRestored?: (content: Record<string, unknown>) => Promise<void>
}

export async function replaySnapshots<T extends ObjectLiteral>(
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
export async function replayLocaleSnapshotsByKey(em: EntityManager, key: string) {
  await replaySnapshots(em, {
    modelName: WalnutModelName.SYS_LOCALE,
    entityTarget: SysLocaleEntity,
    whereColumn: 'key',
    whereValue: key,
  })
}

export function readStringField(content: Record<string, unknown>, field: string): string | null {
  const value = content[field]
  return typeof value === 'string' && value !== '' ? value : null
}
