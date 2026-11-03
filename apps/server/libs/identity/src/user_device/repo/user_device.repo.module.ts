import { Global, Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { WalnutPGConnectionName } from '@walnut-server/db'
import { SysUserDeviceEntity } from '../entity/user-device.entity'
import { SysUserDeviceRepositoryService } from './user_device.repo.service'

/**
 * B6 迁移：Mongo forFeature 摘除，换 PG forFeature（B1 确立的接线形态）。
 *
 * 模块保持 @Global —— 消费方跨 identity / system / app-domain / security 多域（> 1），
 * 判据 ①b 登记（repo-global.drift.spec.ts）。
 */
@Global()
@Module({
  imports: [
    TypeOrmModule.forFeature([SysUserDeviceEntity], WalnutPGConnectionName),
  ],
  controllers: [],
  providers: [SysUserDeviceRepositoryService],
  exports: [SysUserDeviceRepositoryService],
})
export class SysUserDeviceRepositoryModule { }
