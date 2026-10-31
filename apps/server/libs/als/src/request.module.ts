import { Global, Module } from '@nestjs/common'
import { ALSRequestService } from './request.service'

@Global()
@Module({
  providers: [ALSRequestService],
  exports: [ALSRequestService],
})
export class AppALSRequestModule {}
