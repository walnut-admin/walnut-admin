import type { EntityManager } from 'typeorm'
import { Injectable } from '@nestjs/common'
import { InjectDataSource } from '@nestjs/typeorm'
import { WalnutPGConnectionName } from '@walnut-server/db'
import { compare, genSalt, hash } from 'bcryptjs'
import { DataSource } from 'typeorm'

import { SysUserLockEntity } from '../entity/user-lock.entity'

/**
 * B7b 迁移：Mongo model → PG 命名连接 DataSource（B2/B6/B7a 同款形态）。
 *
 * - 事务句柄 `dbSession?: ClientSession` → `em?: EntityManager`（缺省连接级 manager）；
 * - `new Types.ObjectId(userId)` 包装摘除（phase3-plan §4 B7 项），uuid 直传；
 * - **schema pre('save') 的 bcrypt hash 迁到本仓库的写入路径**（insertOrUpdateUserLockPre，
 *   phase2 4.11 备注）：原钩子在 save 前对改动的 lockPwdHash 加盐 hash —— 本仓库唯一的
 *   写入路径承接同样语义，写入路径全覆盖；读路径不 hash；
 * - findOneAndUpdate(upsert, returnDocument 'after') 语义 → ON CONFLICT (user_id)
 *   DO UPDATE + 复查承接（B6 upsertDevice 同款手法：点查拿受管实体）。
 */
@Injectable()
export class SysUserLockRepositoryService {
  constructor(
    @InjectDataSource(WalnutPGConnectionName)
    private readonly dataSource: DataSource,
  ) {}

  private getManager(em?: EntityManager) {
    return em ?? this.dataSource.manager
  }

  private getRepository(em?: EntityManager) {
    return this.getManager(em).getRepository(SysUserLockEntity)
  }

  /**
   * @description compare password with hash
   */
  async compareLockPwdHash(pwd: string, hashedPwd: string) {
    return compare(pwd, hashedPwd)
  }

  /**
   * @description find user lock pre by user id
   */
  async findUserLockPreByUserId(userId: string, em?: EntityManager) {
    return this.getRepository(em).findOne({ where: { userId } })
  }

  /**
   * @description insert or update user lock preference
   *
   * 写入路径显式 hash：payload 带 lockPwdHash 时先加盐 bcrypt（对齐原 pre('save')
   * 钩子「改动即 hash」的切入点），再 ON CONFLICT (user_id) upsert。
   */
  async insertOrUpdateUserLockPre(userId: string, userLockPre: Partial<SysUserLockEntity>, em?: EntityManager) {
    const payload: Partial<SysUserLockEntity> = { ...userLockPre }

    if (payload.lockPwdHash !== null && payload.lockPwdHash !== undefined && payload.lockPwdHash !== '') {
      const salt = await genSalt()
      payload.lockPwdHash = await hash(payload.lockPwdHash, salt)
    }

    const overwriteColumns = Object.keys(payload)
      .filter(k => k !== 'userId')
      .map(k => this.getPropertyColumnName(k))

    await this.getManager(em)
      .createQueryBuilder()
      .insert()
      .into(SysUserLockEntity)
      // QueryDeepPartialEntity 表达不了 jsonb 自由对象（IUserLockRoute 的
      // query/params 索引签名），实体直塞由驱动参数化 —— cast 收口
      .values({ userId, ...payload } as never)
      .orUpdate(overwriteColumns, ['user_id'])
      .execute()

    // returnDocument: 'after' 语义由复查承接（首插的缺省列走 DB 默认值，
    // 如 lock_cross_device / lock_mode）
    return this.findUserLockPreByUserId(userId, em) as Promise<SysUserLockEntity>
  }

  /**
   * 实体属性名 → 列名：列名真源在实体元数据（显式 name 声明），不手工维护第二份映射。
   */
  private getPropertyColumnName(property: string): string {
    const metadata = this.dataSource.getMetadata(SysUserLockEntity)
    const column = metadata.findColumnWithPropertyPath(property)
    return column?.databaseName ?? property
  }
}
