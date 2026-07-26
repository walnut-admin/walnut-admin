import { Global, Module } from '@nestjs/common'
import { AuthSessionService } from './session.service'

@Global()
@Module({
  imports: [],
  controllers: [],
  providers: [AuthSessionService],
  exports: [AuthSessionService],
})
export class AuthSessionModule {}
