import { Module } from '@nestjs/common'
import { AuthOpaqueAdminModule } from './admin/opaque.admin.module'
import { AuthOpaqueCoreModule } from './core/opaque.core.module'
import { AuthOpaqueUserModule } from './user/opaque.user.module'

// TODO 还差注册和忘记密�?

@Module({
  imports: [
    AuthOpaqueCoreModule,
    AuthOpaqueUserModule,
    AuthOpaqueAdminModule,
  ],
  controllers: [],
  providers: [],
  exports: [],
})
export class AuthOpaqueModule {}
