import { Global, Module } from '@nestjs/common'
import { AppTechCookieService } from './cookie.service'

@Global()
@Module({
  imports: [],
  providers: [AppTechCookieService],
  exports: [AppTechCookieService],
})
export class AppTechCookieModule {}
