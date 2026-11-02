import { Module } from '@nestjs/common'
import { SysUserIdentityRepositoryModule } from '@walnut-server/identity'
import { AuthSignoutModule } from '../../signout/signout.module'
import { AuthOpaqueCoreModule } from '../core/opaque.core.module'
import { AuthOpaqueAdminService } from './opaque.admin.service'

@Module({
  imports: [
    AuthOpaqueCoreModule,
    AuthSignoutModule,
    SysUserIdentityRepositoryModule,
  ],
  providers: [AuthOpaqueAdminService],
  exports: [AuthOpaqueAdminService],
})
export class AuthOpaqueAdminModule {}
