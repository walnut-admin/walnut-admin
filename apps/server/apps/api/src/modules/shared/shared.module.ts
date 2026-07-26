import { Module } from '@nestjs/common'
import { SharedAliModule } from './ali/ali.module'
import { AppALSRequestModule } from './als/request/request.module'
import { SharedAreaModule } from './area/area.module'
import { SharedBLPathModule } from './BLPath/BLPath.module'
import { SharedDelayModule } from './delay/delay.module'
import { SharedIpModule } from './ip/ip.module'
import { SharedMaskModule } from './mask/mask.module'
import { AppTokenModule } from './token/token.module'

@Module({
  imports: [AppTokenModule, SharedAliModule, SharedAreaModule, AppALSRequestModule, SharedDelayModule, SharedBLPathModule, SharedIpModule, SharedMaskModule],
})
export class SharedModule {}
