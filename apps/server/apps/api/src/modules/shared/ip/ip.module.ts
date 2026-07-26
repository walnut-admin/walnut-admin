import { HttpModule } from '@nestjs/axios'
import { Global, Module } from '@nestjs/common'
import { SharedIpService } from './ip.service'

@Global()
@Module({
  imports: [HttpModule],
  providers: [SharedIpService],
  exports: [SharedIpService],
})
export class SharedIpModule {}
