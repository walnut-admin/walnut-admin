import { Global, Module } from '@nestjs/common'
import { MongooseModule } from '@nestjs/mongoose'
import { WalnutDBConnectionName, WalnutDBModelName } from '@walnut-server/db'
import { SysUserMfaSchema } from '../schema/user_mfa.schema'
import { SysUserMfaRepositoryService } from './user_mfa.repo.service'

@Global()
@Module({
  imports: [
    MongooseModule.forFeature(
      [{ name: WalnutDBModelName.SYS_USER_MFA, schema: SysUserMfaSchema }],
      WalnutDBConnectionName,
    ),
  ],
  controllers: [],
  providers: [SysUserMfaRepositoryService],
  exports: [SysUserMfaRepositoryService],
})
export class SysUserMfaRepositoryModule { }
