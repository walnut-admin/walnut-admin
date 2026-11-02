import type { DataSource, EntityManager } from 'typeorm'
import { Injectable } from '@nestjs/common'
import { InjectDataSource } from '@nestjs/typeorm'
import { WalnutModelName, WalnutPGConnectionName } from '@walnut-server/db'

import { WalnutAdminCommonPgBaseRepository } from '@walnut-server/repository'
import { SysDeviceEntity } from './entity/device.entity'

/**
 * B6 迁移模板（repo 层）：类名与文件名保持不变（DI token 不动），基类从 Mongo 版
 * `WalnutAdminCommonBasicRepository` 换成 PG 版。device 自身的 CRUD 全走基类公共面；
 * 按业务键 device_id 的特有查询在 `SysDeviceRepositoryService`（QueryBuilder 语义对照
 * Mongo 版，不拼原生 SQL）。
 *
 * F-31 重构（裁决 Q6=b）：`device.service.initial` 原先自己 `em.getRepository(SysDeviceEntity)`
 * 做 upsert（「服务即数据面」的第 4 形态），现在下沉到本类的 `upsertByDeviceId` ——
 * 服务只编排（拼 deviceData、after-commit 双写缓存），事务句柄 em 原样透传，SQL 语义不变。
 */
@Injectable()
export class SysDeviceBasicRepository extends WalnutAdminCommonPgBaseRepository<SysDeviceEntity> {
  constructor(
    @InjectDataSource(WalnutPGConnectionName)
    dataSource: DataSource,
  ) {
    super(SysDeviceEntity, WalnutModelName.SYS_DEVICE, dataSource)
  }

  /**
   * @description 按业务键 device_id upsert 一行设备（B6 initial 的写入腿）
   *
   * 「查到即整体覆盖（$set + returnDocument: 'after'）、否则插入」的 PG 形态：查无则
   * create + save（deviceData 自带 deviceId，与调用方传进来的业务键是同一个值），查到则
   * Object.assign 覆盖后 save。撞 uq_device_id / uq_device_name 的 23505 由调用方 catch
   * 处理（与迁移前的分层一致：冲突语义是业务错误，不是仓库职责）。
   *
   * `em` 为事务句柄透传（`@WalnutTxSession()` 的 WalnutTxContext.em）：调用方传入即同一
   * 事务，缺省落连接级 manager —— 与迁移前 `em.getRepository(...)` 的取法逐字一致。
   */
  async upsertByDeviceId(
    deviceId: string,
    deviceData: Partial<SysDeviceEntity>,
    em?: EntityManager,
  ): Promise<SysDeviceEntity> {
    const repository = this.getManager(em).getRepository(SysDeviceEntity)

    const existing = await repository.findOne({ where: { deviceId } })
    if (existing) {
      Object.assign(existing, deviceData)
      return repository.save(existing)
    }

    return repository.save(repository.create(deviceData))
  }
}
