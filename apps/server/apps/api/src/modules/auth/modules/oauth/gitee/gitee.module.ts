import { Module } from '@nestjs/common'
import { SysUserIdentitySharedModule } from '@/modules/system/user_identity/shared/user_identity.shared.module'
import { AppTechSseModule } from '@/modules/techniques/sse/sse.module'
import { AuthSharedModule } from '../../shared/shared.module'
import { OAuthGiteeController } from './gitee.controller'
import { OAuthGiteeService } from './gitee.service'
import { OAuthGiteeStrategy } from './gitee.strategy'

@Module({
  imports: [
    AppTechSseModule,
    AuthSharedModule,
    SysUserIdentitySharedModule,
  ],
  controllers: [OAuthGiteeController],
  providers: [OAuthGiteeService, OAuthGiteeStrategy],
  exports: [OAuthGiteeService],
})
export class OAuthGiteeModule {}
