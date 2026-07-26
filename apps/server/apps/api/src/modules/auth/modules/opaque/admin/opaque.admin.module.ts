import { Module } from '@nestjs/common'
import { SysUserIdentityRepositoryModule } from '@/modules/system/user_identity/repo/user_identity.repo.module'
import { AuthSignoutModule } from '../../signout/signout.module'
import { AuthOpaqueCoreModule } from '../core/opaque.core.module'
import { AuthOpaqueAdminController } from './opaque.admin.controller'
import { AuthOpaqueAdminService } from './opaque.admin.service'

@Module({
  imports: [
    AuthOpaqueCoreModule,
    AuthSignoutModule,
    SysUserIdentityRepositoryModule,
  ],
  controllers: [AuthOpaqueAdminController],
  providers: [AuthOpaqueAdminService],
  exports: [AuthOpaqueAdminService],
})
export class AuthOpaqueAdminModule {}
