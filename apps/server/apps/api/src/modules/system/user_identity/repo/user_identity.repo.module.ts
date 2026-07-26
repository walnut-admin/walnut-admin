import { Global, Module } from '@nestjs/common'
import { MongooseModule } from '@nestjs/mongoose'

import { WalnutDBConnectionName, WalnutDBModelName } from '@walnut-server/db'

import { SysUserIdentitySchema } from '../schema/user_identity.schema'
import { SysUserIdentityRepositoryService } from './user_identity.repo.service'

@Global()
@Module({
  imports: [
    MongooseModule.forFeature(
      [{ name: WalnutDBModelName.SYS_USER_IDENTITY, schema: SysUserIdentitySchema }],
      WalnutDBConnectionName,
    ),
  ],
  providers: [SysUserIdentityRepositoryService],
  exports: [SysUserIdentityRepositoryService],
})
export class SysUserIdentityRepositoryModule {}
