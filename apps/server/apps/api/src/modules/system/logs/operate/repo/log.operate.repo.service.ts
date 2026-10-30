/* eslint-disable no-restricted-syntax -- 操作日志是 fire-and-forget 旁路写（decorator tap 内发起、吞错、不参与业务事务）；读日志走 SysLogOperateBasicRepository（已注入数据权限）。 */
import type { DataSource } from 'typeorm'
import { Injectable } from '@nestjs/common'
import { InjectDataSource } from '@nestjs/typeorm'
import { WalnutPGConnectionName } from '@walnut-server/db'

import { SysLogOperateDTO } from '../dto/log.operate.dto'
import { SysLogOperateEntity } from '../entity/log-operate.entity'

/**
 * Log Operate Repository Service
 *
 * Provides simple CRUD operations for cross-module access.
 * NO business logic - only data access.
 *
 * B8 迁移：Mongo model → PG 命名连接 DataSource（B7b refresh.repo 同款形态）。
 * 刻意**不收事务句柄**（无 `em?` 形参）—— 操作日志是 fire-and-forget 旁路写
 * （decorator tap 里发起、吞错），必须不参与业务请求的主事务；连接级 manager
 * 的独立隐式事务即旁路语义。
 */
@Injectable()
export class SysLogOperateRepoService {
  constructor(
    @InjectDataSource(WalnutPGConnectionName)
    private readonly dataSource: DataSource,
  ) {}

  /**
   * @description create operate log（旁路写；调用方自行吞错）
   */
  async create(
    dto: SysLogOperateDTO & {
      // Q7 定案的 ETL 原文旁路列：request/response 序列化失败时 jsonb 列置空、原文落这里
      rawRequestData?: string | null
      rawResponseData?: string | null
    },
  ) {
    const repository = this.dataSource.manager.getRepository(SysLogOperateEntity)
    // 单对象 create 命中 TypeORM 的批量重载签名，显式收窄回单实体（基类 create 同款）
    const created = repository.create(dto as never) as unknown as SysLogOperateEntity
    return repository.save(created)
  }
}
