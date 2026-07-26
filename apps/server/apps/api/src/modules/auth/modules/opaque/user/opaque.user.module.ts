import { Module } from '@nestjs/common'
import { AuthSharedModule } from '../../shared/shared.module'
import { AuthSignoutModule } from '../../signout/signout.module'
import { AuthOpaqueCoreModule } from '../core/opaque.core.module'
import { AuthOpaqueUserController } from './opaque.user.controller'
import { AuthOpaqueUserService } from './opaque.user.service'
import { AuthOpaqueUserStrategy } from './opaque.user.strategy'

@Module({
  imports: [
    AuthSharedModule,
    AuthOpaqueCoreModule,
    AuthSignoutModule,
  ],
  controllers: [AuthOpaqueUserController],
  providers: [AuthOpaqueUserService, AuthOpaqueUserStrategy],
  exports: [AuthOpaqueUserService],
})
export class AuthOpaqueUserModule {}
