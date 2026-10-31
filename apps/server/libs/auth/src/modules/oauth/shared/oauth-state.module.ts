import { Module } from '@nestjs/common'
import { OAuthStateService } from './oauth-state.service'

/**
 * OAuth 公共通道（gitee / github 对称消费）：state 签发与一次性校验（P2-13）。
 * CacheModule 是 @Global，OAuthStateService 只额外需要 ConfigService。
 */
@Module({
  providers: [OAuthStateService],
  exports: [OAuthStateService],
})
export class OAuthStateModule {}
