import { Global, Module } from '@nestjs/common'
import { MongooseModule } from '@nestjs/mongoose'
import { WalnutDBConnectionName, WalnutDBModelName } from '@walnut/db'
import { SysUserOauthSchema } from '../schema/user_oauth.schema'
import { SysUserOAuthRepositoryService } from './user_oauth.repo.service'

@Global()
@Module({
  imports: [
    MongooseModule.forFeature(
      [{ name: WalnutDBModelName.SYS_USER_OAUTH, schema: SysUserOauthSchema }],
      WalnutDBConnectionName,
    ),
  ],
  controllers: [],
  providers: [SysUserOAuthRepositoryService],
  exports: [SysUserOAuthRepositoryService],
})
export class SysUserOAuthRepositoryModule { }
