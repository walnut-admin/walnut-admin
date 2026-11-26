import { Module } from '@nestjs/common'
import { SysUserIdentitySharedModule } from '@walnut-server/identity'
import { AuthSharedModule } from '../../shared/shared.module'
import { AuthOpaqueCoreService } from '../core/opaque.core.service'

@Module({
  // ①：password 身份的加解密 / 盐化哈希统一走 identity 的 shared service
  imports: [AuthSharedModule, SysUserIdentitySharedModule],
  controllers: [],
  providers: [AuthOpaqueCoreService],
  exports: [AuthOpaqueCoreService],
})
export class AuthOpaqueCoreModule {}
