import type { EntityManager } from 'typeorm'
import { Injectable } from '@nestjs/common'
import { InjectDataSource } from '@nestjs/typeorm'
import { WalnutPGConnectionName } from '@walnut-server/db'
import { compare, genSalt, hash } from 'bcryptjs'
import { DataSource } from 'typeorm'

import { SysUserLockEntity } from '../entity/user-lock.entity'
import { getLockPwdBackoffSeconds } from '../lock-pwd-backoff'

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
    // `undefined` 键**必须摘掉**（2026-11-27 实测）：DTO 经 class-transformer 之后可能带
    // `lockCrossDevice: undefined` 这类自有属性，spread 进 `.values()` 会生成显式 NULL
    // —— `lock_cross_device` 是 NOT NULL，插入直接 50000。只保留「真的有值」的键。
    const payload: Partial<SysUserLockEntity> = {}
    for (const [key, value] of Object.entries(userLockPre)) {
      if (value !== undefined) {
        (payload as Record<string, unknown>)[key] = value
      }
    }

    // L1 / D2 修复（2026-11-27）：空串**不是**「把哈希清空」的合法语义 —— 旧实现把 '' 原样
    // 塞进 overwriteColumns（不 hash），一次 `{lockMode:'security', lockPwdHash:''}` 就把行
    // 写成「security 模式 + 空哈希」= 该用户永久解不开锁。这里在写入路径上直接摘除该键
    // （视为「不修改」），service 层的显式校验负责给出受控 40000。
    if (payload.lockPwdHash === '') {
      delete payload.lockPwdHash
    }

    if (payload.lockPwdHash !== null && payload.lockPwdHash !== undefined) {
      const salt = await genSalt()
      payload.lockPwdHash = await hash(payload.lockPwdHash, salt)
      // 最近设置/变更时间只跟「真的写了新密码」一起落（未传密码的偏好写入不动它）
      payload.lockPwdUpdatedAt = new Date()
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
   * 读取退避状态（只读，可走请求事务的 em）。
   */
  async findUnlockBackoff(userId: string, em?: EntityManager) {
    const row = await this.getRepository(em).findOne({
      where: { userId },
      select: { lockPwdFailCount: true, lockPwdLockedUntil: true },
    })

    return row
      ? { failCount: row.lockPwdFailCount ?? 0, lockedUntil: row.lockPwdLockedUntil }
      : null
  }

  /**
   * 记一次解锁失败（L1 / Q7）。
   *
   * **刻意不走请求事务的 em**：调用点在 `@WalnutTx()` 端点里「比对失败 → 抛 40000」，
   * 请求事务会随异常回滚 —— 若计数写在同一事务里，失败次数永远落不了库（退避形同虚设）。
   * 这里用 `dataSource.transaction` 开一条**独立的**自动提交事务：请求事务只做了
   * 无锁 SELECT（未持有行锁），独立事务的 `FOR UPDATE` 不会与它互等。
   *
   * 计数 + 截止时间在一把行锁内算完：并发失败不会互相覆盖（曲线真源在
   * `lock-pwd-backoff.ts`，SQL 不复制一份）。
   */
  async recordUnlockFailure(userId: string): Promise<{ failCount: number, lockedUntil: Date | null } | null> {
    return this.dataSource.transaction(async (manager) => {
      const rows: Array<{ lock_pwd_fail_count: number }> = await manager.query(
        'SELECT lock_pwd_fail_count FROM sys_user_lock WHERE user_id = $1 FOR UPDATE',
        [userId],
      )

      if (rows.length === 0) {
        return null
      }

      const failCount = (rows[0].lock_pwd_fail_count ?? 0) + 1
      const backoffSeconds = getLockPwdBackoffSeconds(failCount)
      const lockedUntil = backoffSeconds === null ? null : new Date(Date.now() + backoffSeconds * 1000)

      await manager.query(
        `UPDATE sys_user_lock
            SET lock_pwd_fail_count = $2,
                lock_pwd_locked_until = $3,
                updated_at = now()
          WHERE user_id = $1`,
        [userId, failCount, lockedUntil],
      )

      return { failCount, lockedUntil }
    })
  }

  /**
   * 清零计数与退避（成功解锁 / fallback 验证通过 / 管理员重置）。
   * 走调用方事务（与解锁执行腿一起提交）。
   */
  async clearUnlockFailure(userId: string, em?: EntityManager) {
    await this.getRepository(em).update(
      { userId },
      { lockPwdFailCount: 0, lockPwdLockedUntil: null },
    )
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
