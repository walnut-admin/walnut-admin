import { Global, Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { WalnutPGConnectionName } from '@walnut-server/db'
import { SysDeviceEntity } from '../entity/device.entity'
import { SysDevicePgPurgeService } from './device.pg.purge.service'
import { SysDeviceRepositoryService } from './device.repo.service'

/**
 * B6 迁移：Mongo forFeature 摘除，换 PG forFeature（B1 确立的接线形态）。
 *
 * 模块保持 @Global —— 消费方跨 system / auth / security / app 多域（> 1），
 * 判据 ①b 登记（repo-global.drift.spec.ts）。
 */
@Global()
@Module({
  imports: [
    TypeOrmModule.forFeature([SysDeviceEntity], WalnutPGConnectionName),
  ],
  controllers: [],
  // SYS_DEVICE_RETENTION_PURGE（批次 11）：90 天留存清理 cron —— 与本仓库同模块，
  // 数据访问仍走 SysDeviceRepositoryService，cron 只编排 + 打日志。
  providers: [SysDeviceRepositoryService, SysDevicePgPurgeService],
  exports: [SysDeviceRepositoryService, SysDevicePgPurgeService],
})
export class SysDeviceRepositoryModule {}
