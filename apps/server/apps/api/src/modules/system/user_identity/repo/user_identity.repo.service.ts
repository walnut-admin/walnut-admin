import type { EntityManager } from 'typeorm'
import { Injectable } from '@nestjs/common'
import { InjectDataSource } from '@nestjs/typeorm'
import { WalnutPGConnectionName } from '@walnut-server/db'
import { DataSource } from 'typeorm'

import { SysUserIdentityEntity } from '../entity/user-identity.entity'
import {
  IWalnutAdminConstSysUserIdentityPurpose,
  IWalnutAdminConstSysUserIdentityType,
} from '../schema/user_identity.schema'

/**
 * B7a 迁移：Mongo model → PG 命名连接 DataSource（跨模块消费的仓库服务直持 DataSource，
 * B2/B6 同款形态）。方法面与 Mongo 版一一对齐：
 *
 * - 事务句柄 `dbSession?: ClientSession` → `em?: EntityManager`（缺省连接级 manager）；
 * - `new Types.ObjectId(userId)` 包装摘除（phase3-plan §4 B7 项），uuid 直传；
 * - value 列 select:false —— 默认查询不出（对齐 Mongo `select: false`），取值走
 *   getValueByUserIdTypeAndPurpose 的显式 addSelect 通道；
 * - findOneAndUpdate / findOneAndDelete 的「命中即改、未命中返回 null」语义在方法内
 *   复刻（先 find 后写，null 不抛）。
 */
@Injectable()
export class SysUserIdentityRepositoryService {
  constructor(
    @InjectDataSource(WalnutPGConnectionName)
    private readonly dataSource: DataSource,
  ) {}

  private getManager(em?: EntityManager) {
    return em ?? this.dataSource.manager
  }

  private getRepository(em?: EntityManager) {
    return this.getManager(em).getRepository(SysUserIdentityEntity)
  }

  /**
   * @description get decrypted-able value by userId + type + purpose（select:false 例外通道：
   * 显式 addSelect 把密文列带回实体）
   */
  async getValueByUserIdTypeAndPurpose(
    userId: string,
    type: IWalnutAdminConstSysUserIdentityType,
    purpose: IWalnutAdminConstSysUserIdentityPurpose,
    em?: EntityManager,
  ) {
    const row = await this.getManager(em)
      .createQueryBuilder(SysUserIdentityEntity, 'identity')
      .addSelect('identity.value')
      .where('identity.userId = :userId', { userId })
      .andWhere('identity.type = :type', { type })
      .andWhere('identity.purpose = :purpose', { purpose })
      .getOne()

    return row?.value
  }

  // Find identity by userId, type and purpose
  async findByUserIdTypeAndPurpose(
    userId: string,
    type: IWalnutAdminConstSysUserIdentityType,
    purpose: IWalnutAdminConstSysUserIdentityPurpose,
    em?: EntityManager,
  ) {
    return this.getRepository(em).findOne({ where: { userId, type, purpose } })
  }

  // Find all identities by userId
  async findByUserId(
    userId: string,
    em?: EntityManager,
  ) {
    return this.getRepository(em).find({ where: { userId } })
  }

  // Find identity by type, purpose and value hash (for checking existence)
  async findByValueHash(
    type: IWalnutAdminConstSysUserIdentityType,
    purpose: IWalnutAdminConstSysUserIdentityPurpose,
    valueHash: string,
    em?: EntityManager,
  ) {
    return this.getRepository(em).findOne({ where: { type, purpose, valueHash } })
  }

  // Create identity
  async createIdentity(
    payload: Partial<SysUserIdentityEntity>,
    em?: EntityManager,
  ) {
    const repository = this.getRepository(em)
    return repository.save(repository.create(payload))
  }

  // Update identity by userId, type and purpose（returnDocument: 'after' 语义，未命中 null）
  async updateByUserIdTypeAndPurpose(
    userId: string,
    type: IWalnutAdminConstSysUserIdentityType,
    purpose: IWalnutAdminConstSysUserIdentityPurpose,
    payload: Partial<SysUserIdentityEntity>,
    em?: EntityManager,
  ) {
    const repository = this.getRepository(em)

    const target = await repository.findOne({ where: { userId, type, purpose } })
    if (!target) {
      return null
    }

    Object.entries(payload).forEach(([k, v]) => {
      if (k !== 'id') {
        (target as unknown as Record<string, unknown>)[k] = v
      }
    })

    return repository.save(target)
  }

  // Delete identity by userId, type and purpose（findOneAndDelete 语义：返回删除前行，未命中 null）
  async deleteByUserIdTypeAndPurpose(
    userId: string,
    type: IWalnutAdminConstSysUserIdentityType,
    purpose: IWalnutAdminConstSysUserIdentityPurpose,
    em?: EntityManager,
  ) {
    const repository = this.getRepository(em)

    const target = await repository.findOne({ where: { userId, type, purpose } })
    if (!target) {
      return null
    }

    // remove() 会就地清空生成列，返回删除前快照
    const snapshot: SysUserIdentityEntity = { ...target }
    await repository.remove(target)
    return snapshot
  }
}
