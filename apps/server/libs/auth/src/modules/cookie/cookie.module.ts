import { Module } from '@nestjs/common'
import { AuthCookieService } from './cookie.service'

@Module({
  imports: [],
  providers: [AuthCookieService],
  exports: [AuthCookieService],
})
export class AuthCookieModule {}
