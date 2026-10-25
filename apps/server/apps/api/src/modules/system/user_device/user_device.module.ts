import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { WalnutPGConnectionName } from '@walnut-server/db'
import { AuthSignoutModule } from '@/modules/auth/modules/signout/signout.module'
import { SysUserLockSharedModule } from '../user_lock/shared/user_lock.shared.module'
import { SysUserDeviceEntity } from './entity/user-device.entity'
import { SysUserDeviceRepositoryModule } from './repo/user_device.repo.module'
import { SysUserDeviceController } from './user_device.controller'
import { SysUserDeviceService } from './user_device.service'

/**
 * B6 迁移：Mongo forFeature 摘除，换 PG forFeature（B1 确立的接线形态，不另建 pg.module）。
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([SysUserDeviceEntity], WalnutPGConnectionName),
    SysUserDeviceRepositoryModule,
    SysUserLockSharedModule,
    AuthSignoutModule,
  ],
  controllers: [SysUserDeviceController],
  providers: [SysUserDeviceService],
  exports: [SysUserDeviceService],
})
export class SysUserDeviceModule {}
