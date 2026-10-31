import { Global, Module } from '@nestjs/common'
import { SharedMaskService } from './mask.service'

@Global()
@Module({
  providers: [SharedMaskService],
  exports: [SharedMaskService],
})
export class SharedMaskModule {}
