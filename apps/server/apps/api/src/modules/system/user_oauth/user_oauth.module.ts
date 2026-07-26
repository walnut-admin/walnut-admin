import { Module } from '@nestjs/common'
import { MongooseModule } from '@nestjs/mongoose'
import { WalnutDBConnectionName, WalnutDBModelName } from '@walnut-server/db'

import { SysUserOAuthRepositoryModule } from './repo/user_oauth.repo.module'
import { SysUserOauthSchema } from './schema/user_oauth.schema'
import { SysUserOAuthBasicRepository } from './user_oauth.basic.repository'
import { SysUserOauthController } from './user_oauth.controller'
import { SysUserOauthService } from './user_oauth.serivce'

@Module({
  imports: [
    MongooseModule.forFeature(
      [
        {
          name: WalnutDBModelName.SYS_USER_OAUTH,
          schema: SysUserOauthSchema,
        },
      ],
      WalnutDBConnectionName,
    ),
    SysUserOAuthRepositoryModule,
  ],
  controllers: [SysUserOauthController],
  providers: [SysUserOAuthBasicRepository, SysUserOauthService],
  exports: [SysUserOauthService],
})
export class SysUserOauthModule {}
