import type { EntityManager } from 'typeorm'
import { Injectable } from '@nestjs/common'
import { runAfterCommit, WalnutModelName, WalnutVirtualName } from '@walnut-server/db'

import { WalnutAdminExceptionBadRequest } from '@walnut-server/exceptions/base.exception'
import { WalnutAdminExceptionDataNotFound } from '@walnut-server/exceptions/base/404'
import { DataScopeService } from '../data-scope/data-scope.service'
import { SysUserRepositoryService } from '../user/repo/user.repo.service'
import { SysDeletedBasicRepository } from './deleted.basic.repository'
import { SysDeletedDTORecoverRequest, SystemDeletedDTOListRequest } from './dto/deleted.dto'
import { SysDeletedEntity } from './entity/deleted.entity'
import { SysDeletedPgRecoverRegistry } from './repo/recover-registry'

/**
 * 回收站服务（B9 起 PG 单轨）：软删写入在 `SysDeletedPgRepoService.createSoftDelete`
 * （pg-base.repository 的 deleteSoftById 统一走它），本服务承接读腿与恢复编排 ——
 *
 * - 恢复按 `modelName` 路由到 `SysDeletedPgRecoverRegistry`（B0 注册表，B9 装配），
 *   替代 Mongo 版 `db.model(modelName)` 的运行时动态模型；未注册 modelName 抛受控
 *   错误。快照 content 是 jsonb 对象，恢复 = 原表 insert 快照行 + 删除 sys_deleted
 *   行，两步写同一 `em` 事务（recover 端点由 WalnutTxInterceptor 统一 commit/rollback，
 *   任何一步抛错全量回滚、无残留）。
 * - Mongo 版的 `restoreSnapshotContent`（ObjectId hex 逐字段还原）随双轨退役：
 *   B0 起快照即 PG 形态，uuid 引用直存直取，无需还原（phase2 §5.3，sys_deleted
 *   本地存量为 0 已在 Phase 2 定案）。
 */
@Injectable()
export class SysDeletedService {
  constructor(
    private readonly deletedBasicRepo: SysDeletedBasicRepository,
    private readonly sysUserRepoService: SysUserRepositoryService,
    private readonly recoverRegistry: SysDeletedPgRecoverRegistry,
    private readonly dataScopeService: DataScopeService,
  ) { }

  async read(id: string) {
    const doc = await this.deletedBasicRepo.readById(id)

    // B9 归一：deletedBy 全量是 PG uuid（软删写入自 B0 起走 SysDeletedPgRepoService），
    // Mongo 窗口的 hex 分支（B7a 过渡态）摘除 —— populate 直查 PG sys_user 同源表
    const user = await this.sysUserRepoService.findUserByUserId(doc.deletedBy)

    return Object.assign(doc, {
      [WalnutVirtualName.USER]: user ? { id: user.id, userName: user.userName } : null,
    })
  }

  async deleteRealMany(ids: string[]) {
    return this.deletedBasicRepo.deleteRealByIdMany(ids)
  }

  async list(payload: SystemDeletedDTOListRequest) {
    return this.deletedBasicRepo.list(payload)
  }

  // recover for me
  async recoverMine(payload: SysDeletedDTORecoverRequest, userId: string, em: EntityManager) {
    const { id, deletedId } = payload

    // find the deleted target（id + deletedId 双键定位，命中不了即 DataNotFound ——
    // 与 Mongo 版 findOne 双条件语义一致）
    const deleted = await this.deletedBasicRepo.findByIdAndDeletedId(id, deletedId, em)

    if (!deleted) {
      throw new WalnutAdminExceptionDataNotFound()
    }

    if (deleted.deletedBy !== userId) {
      throw new WalnutAdminExceptionBadRequest()
    }

    await this.recoverSnapshot(deleted, em)
    await this.invalidateRecoveredDataScope(deleted)

    return true
  }

  // recover for manage
  async recover(payload: SysDeletedDTORecoverRequest, em: EntityManager) {
    const { id, deletedId } = payload

    // find the deleted target
    const deleted = await this.deletedBasicRepo.readById(id, em)

    if (deleted.deletedId !== deletedId) {
      throw new WalnutAdminExceptionBadRequest({ errMsg: 'business.system.delete.recoverFail', _devMsg: 'DeletedId Not Matched' })
    }

    await this.recoverSnapshot(deleted, em)
    await this.invalidateRecoveredDataScope(deleted)

    return true
  }

  /**
   * 数据权限二期：恢复用户时按实时绑定重算其描述符。CUSTOM 改为部门清单后，恢复
   * **不再影响同角色其他成员**（原先的成员快照失效腿随语义演进去除）；删除时已清过，
   * 这里兜底 TTL 内「删除 → 立即恢复」的窗口。
   */
  private async invalidateRecoveredDataScope(deleted: SysDeletedEntity) {
    if (deleted.modelName !== WalnutModelName.SYS_USER) {
      return
    }

    const recoveredUserId = deleted.content.id
    if (typeof recoveredUserId !== 'string' || recoveredUserId === '') {
      return
    }

    await runAfterCommit(async () => {
      await this.dataScopeService.invalidateForUser(recoveredUserId)
    })
  }

  /**
   * 恢复编排（两条恢复路径共用）：注册表路由 → 原表 insert 快照行 → 删除 sys_deleted
   * 行。注册器插入抛错（如唯一约束冲突 / FK 未满足）包装成受控 recoverFail 外抛，
   * 事务由拦截器统一回滚；仅恢复器调用包 try/catch，sys_deleted 删除失败原样上抛
   * （与 Mongo 版一致）。
   */
  private async recoverSnapshot(deleted: SysDeletedEntity, em: EntityManager) {
    const recoverer = this.recoverRegistry.get(deleted.modelName)

    if (!recoverer) {
      // 替代 Mongo 版 `db.model(unknown)` 的 MissingSchemaError（未受控 500）
      throw new WalnutAdminExceptionBadRequest({
        errMsg: 'business.system.delete.recoverFail',
        _devMsg: `no recoverer registered for model "${deleted.modelName}"`,
      })
    }

    try {
      // recover to original collection（快照 jsonb 对象直插，含原 uuid 与时间戳）
      await recoverer.recover(deleted.content, em)
    }
    catch (e) {
      throw new WalnutAdminExceptionBadRequest({ errMsg: 'business.system.delete.recoverFail', _devMsg: e instanceof Error ? e.message : String(e) })
    }

    // delete from delete collection（同一 em → 与上一步同事务）；P3-9：断言恰好命中 1 行
    await this.deletedBasicRepo.deleteRealById(deleted.id, em, { assertAffected: true })
  }
}
