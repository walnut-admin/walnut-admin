import { Module } from '@nestjs/common'
import { SysUserIdentitySharedModule } from '@walnut-server/identity'
import { AppTechSseModule } from '@walnut-server/sse'
import { AuthSharedModule } from '../../shared/shared.module'
import { OAuthStateModule } from '../shared/oauth-state.module'
import { OAuthGiteeService } from './gitee.service'
import { OAuthGiteeStrategy } from './gitee.strategy'

@Module({
  imports: [
    AppTechSseModule,
    AuthSharedModule,
    OAuthStateModule,
    SysUserIdentitySharedModule,
  ],
  providers: [OAuthGiteeService, OAuthGiteeStrategy],
  exports: [OAuthGiteeService],
})
export class OAuthGiteeModule {}
