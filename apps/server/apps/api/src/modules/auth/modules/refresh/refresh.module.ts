import { Module } from '@nestjs/common'
import { AuthCookieModule } from '../cookie/cookie.module'
import { AuthRefreshController } from './refresh.controller'
import { JwtRefreshTokenStrategy } from './refresh.strategy'
import { AuthRefreshRepositoryModule } from './repo/refresh.repo.module'
import { AuthRefreshSharedModule } from './shared/refresh.shared.module'

@Module({
  imports: [
    AuthRefreshSharedModule,
    AuthRefreshRepositoryModule,
    AuthCookieModule,
  ],
  controllers: [AuthRefreshController],
  providers: [JwtRefreshTokenStrategy],
  exports: [],
})
export class AuthRefreshModule { }
