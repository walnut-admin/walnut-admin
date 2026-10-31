import { Global, Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { WalnutPGConnectionName } from '@walnut-server/db'
import { SysDeviceEntity } from '../entity/device.entity'
import { SysDeviceRepositoryService } from './device.repo.service'

/**
 * B6 迁移：Mongo forFeature 摘除，换 PG forFeature（B1 确立的接线形态）。
 */
@Global()
@Module({
  imports: [
    TypeOrmModule.forFeature([SysDeviceEntity], WalnutPGConnectionName),
  ],
  controllers: [],
  providers: [SysDeviceRepositoryService],
  exports: [SysDeviceRepositoryService],
})
export class SysDeviceRepositoryModule {}
