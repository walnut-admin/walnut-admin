/* eslint-disable no-restricted-syntax -- 登录日志是 fire-and-forget 旁路写（auth guard 内发起、吞错、不参与业务事务、且此时无 ALS 请求上下文）；读/删日志走 SysLogAuthBasicRepository（已注入数据权限）。 */
import type { DataSource } from 'typeorm'
import { Injectable } from '@nestjs/common'
import { InjectDataSource } from '@nestjs/typeorm'
import { runInWalnutSystemTransaction, WalnutPGConnectionName } from '@walnut-server/db'

import { SysLogAuthDTO } from '../dto/log.auth.dto'
import { SysLogAuthEntity } from '../entity/log-auth.entity'

/**
 * Log Auth Repository Service
 *
 * Provides simple CRUD operations for cross-module access.
 * NO business logic - only data access.
 *
 * B8 迁移：Mongo model → PG 命名连接 DataSource（B7b refresh.repo 同款形态）。
 * 刻意**不收事务句柄**（无 `em?` 形参）—— 认证日志是 fire-and-forget 旁路写
 * （decorator tap / auth guard 里发起、吞错），必须不参与业务请求的主事务；
 * 连接级 manager 的独立隐式事务即旁路语义。
 */
@Injectable()
export class SysLogAuthRepoService {
  constructor(
    @InjectDataSource(WalnutPGConnectionName)
    private readonly dataSource: DataSource,
  ) {}

  /**
   * @description create auth log（旁路写；调用方自行吞错）
   *
   * F-38：入参是「可插入字段」而不是完整 DTO —— `id`（PK，DB 侧 gen_random_uuid）与
   * `authenticatedAt`（CreateDateColumn）由数据库填，DTO 字段去掉 `?` 之后必须在这里
   * 显式排除，否则调用方得编造主键与时间。
   *
   * 批 6-A：DTO 基座 `createdAt` / `updatedAt` 随 DB 生成列语义改为必填（去掉
   * `@IsOptional`），同样属于「DB 填」的列 —— 一并排除，纯类型收口、运行期零变化
   * （列在实体上是 CreateDateColumn / UpdateDateColumn，插入时由 DB 赋值）。
   */
  async create(dto: Omit<SysLogAuthDTO, 'id' | 'authenticatedAt' | 'createdAt' | 'updatedAt'>) {
    // 数据权限三期：sys_log_auth 缺省 anonymous —— 旁路写必须显式 system 事务
    return runInWalnutSystemTransaction(this.dataSource, async (manager) => {
      const repository = manager.getRepository(SysLogAuthEntity)
      // 单对象 create 命中 TypeORM 的批量重载签名，显式收窄回单实体（基类 create 同款）
      const created = repository.create(dto as never) as unknown as SysLogAuthEntity
      return repository.save(created)
    })
  }
}
