import type { EntityManager } from 'typeorm'
import { Injectable } from '@nestjs/common'
import { InjectDataSource } from '@nestjs/typeorm'
import { WalnutPGConnectionName } from '@walnut-server/db'
import { DataSource } from 'typeorm'

import { SysUserMfaEntity } from '../entity/user-mfa.entity'

/**
 * B7b 迁移：Mongo model → PG 命名连接 DataSource（B2/B6/B7a 同款形态）。
 * totp / webauthn 服务原本直持 Mongo model，本批一并收口到本仓库
 * （三层改造模板：controller → service → repo）。
 *
 * - 事务句柄 `dbSession?: ClientSession` → `em?: EntityManager`（缺省连接级 manager）；
 * - `new Types.ObjectId(userId)` 包装全部摘除（phase3-plan §4 B7 项），uuid 直传；
 * - 四个密文列 select:false —— 默认查询不出（对齐 Mongo `select: false`），取值走
 *   带 WithSecret / WithBackupCodes / WithPublicKey 后缀的显式 addSelect 通道；
 * - aggregateMfaStats：Mongo `$group` → GROUP BY（cron 只消费 userId + deviceCount，
 *   Mongo 版的 devices 数组无人使用，PG 版不组装）。
 */
@Injectable()
export class SysUserMfaRepositoryService {
  constructor(
    @InjectDataSource(WalnutPGConnectionName)
    private readonly dataSource: DataSource,
  ) { }

  private getManager(em?: EntityManager) {
    return em ?? this.dataSource.manager
  }

  private getRepository(em?: EntityManager) {
    return this.getManager(em).getRepository(SysUserMfaEntity)
  }

  /**
   * @description find totp record by user id
   */
  async findTotpByUserId(userId: string, em?: EntityManager) {
    return this.getRepository(em).findOne({
      where: { userId, type: 'totp' },
    })
  }

  /**
   * @description find active totp record by user id
   */
  async findActiveTotpByUserId(userId: string, em?: EntityManager) {
    return this.getRepository(em).findOne({
      where: { userId, type: 'totp', status: true },
    })
  }

  /**
   * @description find totp record by user id with secret ciphertext（select:false 例外通道）
   */
  async findTotpWithSecretByUserId(userId: string, em?: EntityManager) {
    return this.getManager(em)
      .createQueryBuilder(SysUserMfaEntity, 'mfa')
      .addSelect('mfa.totpSecretCiphertext')
      .where('mfa.userId = :userId', { userId })
      .andWhere('mfa.type = :type', { type: 'totp' })
      .andWhere('mfa.status = :status', { status: true })
      .getOne()
  }

  /**
   * @description find totp record by user id and device id（bind 查重）
   */
  async findTotpByUserIdAndDeviceId(userId: string, deviceId: string, em?: EntityManager) {
    return this.getRepository(em).findOne({
      where: { userId, type: 'totp', deviceId },
    })
  }

  /**
   * @description find webauthn record by user id and device id
   */
  async findWebauthnByUserIdAndDeviceId(userId: string, deviceId: string, em?: EntityManager) {
    return this.getRepository(em).findOne({
      where: { userId, deviceId, type: 'webauthn', status: true },
    })
  }

  /**
   * @description find webauthn record by user id
   */
  async findWebauthnByUserId(userId: string, em?: EntityManager) {
    return this.getRepository(em).findOne({
      where: { userId, type: 'webauthn' },
    })
  }

  /**
   * @description find active webauthn devices by user id（注册/认证 options 的凭据列表）
   */
  async findActiveWebauthnByUserId(userId: string, em?: EntityManager) {
    return this.getRepository(em).find({
      where: { userId, type: 'webauthn', status: true },
    })
  }

  /**
   * @description find webauthn record by credential id（凭据 id 全局唯一，uq_user_mfa_credential）
   */
  async findWebauthnByCredentialId(credentialId: string, em?: EntityManager) {
    return this.getRepository(em).findOne({
      where: { webauthnCredentialId: credentialId },
    })
  }

  /**
   * @description find webauthn record by user id + credential id with public key
   * （select:false 例外通道；认证防重放路径）
   */
  async findWebauthnWithPublicKeyByUserIdAndCredentialId(userId: string, credentialId: string, em?: EntityManager) {
    return this.getManager(em)
      .createQueryBuilder(SysUserMfaEntity, 'mfa')
      .addSelect('mfa.webauthnPublicKey')
      .where('mfa.userId = :userId', { userId })
      .andWhere('mfa.webauthnCredentialId = :credentialId', { credentialId })
      .andWhere('mfa.type = :type', { type: 'webauthn' })
      .andWhere('mfa.status = :status', { status: true })
      .getOne()
  }

  /**
   * @description find totp record with backup codes by user id（select:false 例外通道）
   *
   * phase2 4.12 定案：备用码不再是独立 `type: 'backup_codes'` 行（CHECK 只放行
   * totp/webauthn，varchar(8) 也容不下），并入 totp 行的 backup_codes_ciphertext 列。
   */
  async findTotpWithBackupCodesByUserId(userId: string, em?: EntityManager) {
    return this.getManager(em)
      .createQueryBuilder(SysUserMfaEntity, 'mfa')
      .addSelect('mfa.backupCodesCiphertext')
      .where('mfa.userId = :userId', { userId })
      .andWhere('mfa.type = :type', { type: 'totp' })
      .andWhere('mfa.status = :status', { status: true })
      .getOne()
  }

  /**
   * @description create mfa record
   */
  async createMfa(payload: Partial<SysUserMfaEntity>, em?: EntityManager) {
    const repository = this.getRepository(em)
    return repository.save(repository.create(payload))
  }

  /**
   * @description save mfa record
   */
  async saveMfa(document: SysUserMfaEntity, em?: EntityManager) {
    return this.getRepository(em).save(document)
  }

  /**
   * @description delete records by user id and type，返回删除行数（deleteOne 的 deletedCount 语义）
   */
  async deleteByUserIdAndType(userId: string, type: SysUserMfaEntity['type'], em?: EntityManager) {
    const result = await this.getRepository(em).delete({ userId, type })
    return result.affected ?? 0
  }

  /**
   * @description update mfa status by user id and type
   * （findOneAndUpdate 语义：命中即改，未命中返回 null 不抛）
   */
  async updateStatusByUserIdAndType(userId: string, type: SysUserMfaEntity['type'], status: boolean, em?: EntityManager) {
    const repository = this.getRepository(em)

    const target = await repository.findOne({ where: { userId, type } })
    if (!target) {
      return null
    }

    target.status = status
    return repository.save(target)
  }

  /**
   * @description update webauthn counter and last used at（防重放，updateOne 语义）
   */
  async updateWebauthnCounterAndLastUsedAt(id: string, webauthnCounter: number, lastUsedAt: Date, em?: EntityManager) {
    await this.getRepository(em).update({ id }, { webauthnCounter, lastUsedAt })
  }

  /**
   * @description aggregate mfa stats for cron job
   * （Mongo `$group` → GROUP BY；返回行数即用户数，deviceCount 转回 number）
   */
  async aggregateMfaStats(em?: EntityManager) {
    const rows = await this.getManager(em)
      .createQueryBuilder(SysUserMfaEntity, 'mfa')
      .select('mfa.userId', 'userId')
      .addSelect('COUNT(*)', 'deviceCount')
      .where('mfa.type IN (:...types)', { types: ['totp', 'webauthn'] })
      .andWhere('mfa.status = :status', { status: true })
      .groupBy('mfa.userId')
      .getRawMany<{ userId: string, deviceCount: string }>()

    return rows.map(row => ({
      userId: row.userId,
      deviceCount: Number(row.deviceCount),
    }))
  }
}
