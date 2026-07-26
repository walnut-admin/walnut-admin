import { Global, Module } from '@nestjs/common'
import { SharedDelayService } from './delay.service'

@Global()
@Module({
  providers: [SharedDelayService],
  exports: [SharedDelayService],
})
export class SharedDelayModule {}
