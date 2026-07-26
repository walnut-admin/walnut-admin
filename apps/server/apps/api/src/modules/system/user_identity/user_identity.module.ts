import { Module } from '@nestjs/common'
import { MongooseModule } from '@nestjs/mongoose'

import { WalnutDBConnectionName, WalnutDBModelName } from '@walnut/db'
import { OtpSharedModule } from '@/modules/auth/modules/otp/shared/otp.shared.module'

import { SysUserIdentityRepositoryModule } from './repo/user_identity.repo.module'
import { SysUserIdentitySchema } from './schema/user_identity.schema'
import { SysUserIdentitySharedModule } from './shared/user_identity.shared.module'
import { SysUserIdentityBasicRepository } from './user_identity.basic.repository'
import { SysUserIdentityController } from './user_identity.controller'
import { SysUserIdentityService } from './user_identity.service'

@Module({
  imports: [
    MongooseModule.forFeature(
      [{ name: WalnutDBModelName.SYS_USER_IDENTITY, schema: SysUserIdentitySchema }],
      WalnutDBConnectionName,
    ),
    SysUserIdentityRepositoryModule,
    SysUserIdentitySharedModule,
    OtpSharedModule,
  ],
  controllers: [SysUserIdentityController],
  providers: [SysUserIdentityService, SysUserIdentityBasicRepository],
  exports: [SysUserIdentityService],
})
export class SysUserIdentityModule {}
