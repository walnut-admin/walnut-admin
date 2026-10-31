import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { WalnutPGConnectionName } from '@walnut-server/db'
import { SysUserDeviceSharedModule } from '@walnut-server/identity'
import { SysDeviceBasicRepository } from './device.basic.repository'
import { SysDeviceController } from './device.controller'
import { SysDeviceService } from './device.service'
import { SysDeviceSettingService } from './device.setting.service'
import { SysDeviceEntity } from './entity/device.entity'
import { SysDeviceRepositoryModule } from './repo/device.repo.module'
import { SysDeviceSharedModule } from './shared/device.shared.module'

/**
 * B6 迁移：Mongo forFeature 摘除，换 PG forFeature（B1 确立的接线形态，不另建 pg.module）。
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([SysDeviceEntity], WalnutPGConnectionName),
    SysUserDeviceSharedModule,
    SysDeviceSharedModule,
    SysDeviceRepositoryModule,
  ],
  controllers: [SysDeviceController],
  providers: [SysDeviceBasicRepository, SysDeviceService, SysDeviceSettingService],
  exports: [SysDeviceService],
})
export class SysDeviceModule {}
