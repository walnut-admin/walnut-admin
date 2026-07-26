import { Global, Module } from '@nestjs/common'
import { SharedBLPathService } from './BLPath.service'

@Global()
@Module({
  providers: [SharedBLPathService],
  exports: [SharedBLPathService],
})
export class SharedBLPathModule {}
