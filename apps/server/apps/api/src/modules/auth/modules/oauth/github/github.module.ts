import { Module } from '@nestjs/common'
import { SysUserIdentitySharedModule } from '@walnut-server/identity'
import { AppTechSseModule } from '@walnut-server/sse'
import { AuthSharedModule } from '../../shared/shared.module'
import { OAuthStateModule } from '../shared/oauth-state.module'
import { OAuthGithubController } from './github.controller'
import { OAuthGitHubService } from './github.service'
import { OAuthGitHubStrategy } from './github.strategy'

@Module({
  imports: [
    AppTechSseModule,
    AuthSharedModule,
    OAuthStateModule,
    SysUserIdentitySharedModule,
  ],
  controllers: [OAuthGithubController],
  providers: [OAuthGitHubService, OAuthGitHubStrategy],
  exports: [OAuthGitHubService],
})
export class OAuthGitHubModule {}
