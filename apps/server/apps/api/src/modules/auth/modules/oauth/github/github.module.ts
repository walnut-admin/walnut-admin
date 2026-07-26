import { Module } from '@nestjs/common'
import { SysUserIdentitySharedModule } from '@/modules/system/user_identity/shared/user_identity.shared.module'
import { AppTechSseModule } from '@/modules/techniques/sse/sse.module'
import { AuthSharedModule } from '../../shared/shared.module'
import { OAuthGithubController } from './github.controller'
import { OAuthGitHubService } from './github.service'
import { OAuthGitHubStrategy } from './github.strategy'

@Module({
  imports: [
    AppTechSseModule,
    AuthSharedModule,
    SysUserIdentitySharedModule,
  ],
  controllers: [OAuthGithubController],
  providers: [OAuthGitHubService, OAuthGitHubStrategy],
  exports: [OAuthGitHubService],
})
export class OAuthGitHubModule {}
