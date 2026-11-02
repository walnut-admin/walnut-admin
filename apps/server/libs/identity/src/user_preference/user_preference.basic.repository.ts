import type { DataSource, EntityManager } from 'typeorm'
import { Injectable } from '@nestjs/common'
import { InjectDataSource } from '@nestjs/typeorm'
import { WalnutModelName, WalnutPGConnectionName } from '@walnut-server/db'

import { WalnutAdminCommonPgBaseRepository } from '@walnut-server/repository'
import { SysUserPreferenceEntity } from './entity/user-preference.entity'

/**
 * F-31 重构（裁决 Q6=b）：本模块「服务即数据面」下沉到 **Basic Repository**（三种
 * Repository 模式的第一种 —— 与 controller 1:1 的同模块 CRUD，不做业务逻辑、不进 @Global）。
 * B7b 迁移时 B1 定案「原先无 repo 的模块随迁移补数据面」被直接收口在 service 里（服务直持
 * DataSource + getRepository），绕过了「controller 级 service 不许触达数据层」的硬规矩；
 * 本仓库承接那部分数据访问，SQL 语义逐条照搬：
 *
 * - `findOneAndUpdate(..., { upsert: true })` → `INSERT ... ON CONFLICT (user_id) DO UPDATE`
 *   （B6 upsertDevice 同款 QueryBuilder orUpdate 手法；user_id 有 uq_user_preference_user
 *   UNIQUE，冲突目标唯一）。部分列插入未提供的列走 DB 默认值（对齐 Mongo upsert 的 schema
 *   默认值语义），冲突路径只回写本次 payload 携带的列；
 * - payload 为空对象时 Mongo 版只做首插 → ON CONFLICT DO NOTHING（orIgnore）；
 * - bindPreferenceForUser 的 exists + create 语义原样保留（create 走基类，不是裸 save）。
 *
 * 本实体在数据权限注册表里是**豁免**实体（`apps/api/src/common/repository/data-scope.ts`：
 * 用户偏好属于自服务面，按 userId 点查），所以读腿与写入腿用基类给自定义方法留的
 * `getManager(em)` —— 有 em 用 em（事务句柄逐层透传）、无 em 落连接级 manager，与迁移后
 * 的既有行为一致。`create` / 未来需要的 CRUD 走基类公共面（豁免实体的 withScopedManager
 * 同样落到连接级 manager）。
 */
@Injectable()
export class SysUserPreferenceBasicRepository extends WalnutAdminCommonPgBaseRepository<SysUserPreferenceEntity> {
  constructor(
    @InjectDataSource(WalnutPGConnectionName)
    dataSource: DataSource,
  ) {
    super(SysUserPreferenceEntity, WalnutModelName.SYS_USER_PREFERENCE, dataSource)
  }

  /**
   * @description 该账号是否已有偏好行（bindPreferenceForUser 的幂等前置，SQL 仍是 exists 点查）
   */
  async existsByUserId(userId: string, em?: EntityManager): Promise<boolean> {
    return this.getManager(em)
      .getRepository(SysUserPreferenceEntity)
      .exists({ where: { userId } })
  }

  /**
   * @description 按 userId 点查偏好行（查无返回 null，由 service 组装默认偏好）
   */
  async findByUserId(userId: string, em?: EntityManager): Promise<SysUserPreferenceEntity | null> {
    return this.getManager(em)
      .getRepository(SysUserPreferenceEntity)
      .findOne({ where: { userId } })
  }

  /**
   * @description findOneAndUpdate({ userId }, payload, { upsert: true }) 的 PG 版：
   * ON CONFLICT (user_id) DO UPDATE（只回写 payload 携带的列），未提供列两边都走默认值。
   * payload 为空对象时 Mongo 版只做首插，PG 版对应 ON CONFLICT DO NOTHING（orIgnore）。
   */
  async upsertByUserId(userId: string, payload: Partial<SysUserPreferenceEntity>, em?: EntityManager): Promise<void> {
    const overwriteColumns = Object.keys(payload)
      .filter(k => k !== 'userId' && payload[k as keyof SysUserPreferenceEntity] !== undefined)
      .map(k => this.getPropertyColumnName(k))

    const query = this.getManager(em)
      .createQueryBuilder()
      .insert()
      .into(SysUserPreferenceEntity)
      // QueryDeepPartialEntity 表达不了 jsonb 自由对象（layout 状态袋），实体直塞由
      // 驱动参数化 —— cast 收口
      .values({ userId, ...payload } as never)

    if (overwriteColumns.length > 0) {
      await query.orUpdate(overwriteColumns, ['user_id']).execute()
    }
    else {
      await query.orIgnore().execute()
    }
  }

  /**
   * 实体属性名 → 列名：列名真源在实体元数据（显式 name 声明），不手工维护第二份映射。
   */
  private getPropertyColumnName(property: string): string {
    const metadata = this.dataSource.getMetadata(SysUserPreferenceEntity)
    const column = metadata.findColumnWithPropertyPath(property)
    return column?.databaseName ?? property
  }
}
