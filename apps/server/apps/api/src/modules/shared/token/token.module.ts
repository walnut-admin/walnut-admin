import { Global, Module } from '@nestjs/common'
import { JwtModule } from '@nestjs/jwt'
import { PassportModule } from '@nestjs/passport'
import { WALNUT_ADMIN_TOKEN_TTL } from '@walnut-server/cache'

import { JwtConfigClass } from './jwt.config'
import { AppTokenService } from './token.service'

@Global()
@Module({
  imports: [
    PassportModule,
    JwtModule.registerAsync({
      useClass: JwtConfigClass,
    }),
  ],
  controllers: [],
  providers: [
    AppTokenService,
    // cache lib 的 token TTL 端口绑定（libs 解耦批 2 的依赖反转：cache 的
    // mfa/permissions/sign 服务只依赖端口，实现由 app 的 AppTokenService 提供）。
    // 本模块是 @Global，端口对 @Global 的 AppTechCacheModule 全局可见。
    {
      provide: WALNUT_ADMIN_TOKEN_TTL,
      useExisting: AppTokenService,
    },
  ],
  exports: [AppTokenService, WALNUT_ADMIN_TOKEN_TTL],
})
export class AppTokenModule {}
