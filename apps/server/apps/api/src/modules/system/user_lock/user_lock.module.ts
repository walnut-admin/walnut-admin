import { Module } from '@nestjs/common'
import { MongooseModule } from '@nestjs/mongoose'
import { WalnutDBConnectionName, WalnutDBModelName } from '@walnut/db'
import { SysUserLockRepositoryModule } from './repo/user_lock.repo.module'
import { SysUserLockSchema } from './schema/user_lock.schema'
import { SysUserLockSharedModule } from './shared/user_lock.shared.module'
import { SysUserLockController } from './user_lock.controller'
import { SysUserLockService } from './user_lock.service'

@Module({
  imports: [
    MongooseModule.forFeature(
      [
        {
          name: WalnutDBModelName.SYS_USER_LOCK,
          schema: SysUserLockSchema,
        },
      ],
      WalnutDBConnectionName,
    ),
    SysUserLockRepositoryModule,
    SysUserLockSharedModule,
  ],
  controllers: [SysUserLockController],
  providers: [SysUserLockService],
  exports: [SysUserLockService],
})
export class SysUserLockModule {}
