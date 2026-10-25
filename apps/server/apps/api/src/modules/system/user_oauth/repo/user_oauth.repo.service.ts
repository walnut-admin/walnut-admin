import type { EntityManager } from 'typeorm'
import { Injectable } from '@nestjs/common'
import { InjectDataSource } from '@nestjs/typeorm'
import { WalnutPGConnectionName } from '@walnut-server/db'
import { DataSource } from 'typeorm'

import { SysUserOauthEntity } from '../entity/user-oauth.entity'

/**
 * B7a 迁移：Mongo model → PG 命名连接 DataSource。方法面与 Mongo 版一一对齐：
 *
 * - 事务句柄 `dbSession: ClientSession` → `em?: EntityManager`（缺省连接级 manager）；
 * - `new Types.ObjectId(userId)` 包装摘除（phase3-plan §4 B7 项），uuid 直传；
 * - bindOAuthForUser 的 upsert 对照：Mongo 查询键 (userId, provider) 命中即更新
 *   providerId、未命中插入（returnDocument: 'after'）—— PG 侧 check-then-write 复刻，
 *   uq_oauth (provider, provider_id) 的唯一性约束由 DB 承接（同一外部账号只能绑一个用户）。
 */
@Injectable()
export class SysUserOAuthRepositoryService {
  constructor(
    @InjectDataSource(WalnutPGConnectionName)
    private readonly dataSource: DataSource,
  ) { }

  private getManager(em?: EntityManager) {
    return em ?? this.dataSource.manager
  }

  private getRepository(em?: EntityManager) {
    return this.getManager(em).getRepository(SysUserOauthEntity)
  }

  /**
   * @description find oauth binding by provider and provider id
   */
  async findByProviderAndProviderId(
    provider: string,
    providerId: string,
    em?: EntityManager,
  ) {
    return this.getRepository(em).findOne({ where: { provider, providerId } })
  }

  /**
   * @description bind oauth info for user (upsert operation)
   */
  async bindOAuthForUser(userId: string, provider: string, providerId: string, em?: EntityManager) {
    const repository = this.getRepository(em)

    const existing = await repository.findOne({ where: { userId, provider } })
    if (existing) {
      existing.providerId = providerId
      return repository.save(existing)
    }

    return repository.save(repository.create({ userId, provider, providerId }))
  }

  /**
   * @description check existence by partial payload（对照 Mongo 版 model.exists）
   */
  async existsByFields(payload: Partial<SysUserOauthEntity>, em?: EntityManager) {
    const found = await this.getRepository(em).findOne({ where: payload })
    return found !== null
  }

  /**
   * @description create by partial payload（供模块内 service 直用）
   */
  async createByFields(payload: Partial<SysUserOauthEntity>, em?: EntityManager) {
    const repository = this.getRepository(em)
    return repository.save(repository.create(payload))
  }
}
