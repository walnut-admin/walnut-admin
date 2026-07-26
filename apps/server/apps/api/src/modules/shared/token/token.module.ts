import { Global, Module } from '@nestjs/common'
import { JwtModule } from '@nestjs/jwt'
import { PassportModule } from '@nestjs/passport'

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
  providers: [AppTokenService],
  exports: [AppTokenService],
})
export class AppTokenModule {}
