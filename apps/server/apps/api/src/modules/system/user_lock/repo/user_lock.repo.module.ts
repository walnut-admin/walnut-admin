import { Global, Module } from '@nestjs/common'
import { MongooseModule } from '@nestjs/mongoose'
import { WalnutDBConnectionName, WalnutDBModelName } from '@walnut-server/db'
import { SysUserLockSchema } from '../schema/user_lock.schema'
import { SysUserLockRepositoryService } from './user_lock.repo.service'

@Global()
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
  ],
  controllers: [],
  providers: [SysUserLockRepositoryService],
  exports: [SysUserLockRepositoryService],
})
export class SysUserLockRepositoryModule {}
