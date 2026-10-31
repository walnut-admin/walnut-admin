import { Module } from '@nestjs/common'
import { AppALSRequestModule } from '@walnut-server/als'
import { SharedBLPathModule } from '@walnut-server/blpath'
import { SharedDelayModule } from '@walnut-server/delay'
import { SharedAliModule } from './ali/ali.module'
import { SharedAreaModule } from './area/area.module'
import { SharedIpModule } from './ip/ip.module'
import { SharedMaskModule } from './mask/mask.module'
import { AppTokenModule } from './token/token.module'

@Module({
  imports: [AppTokenModule, SharedAliModule, SharedAreaModule, AppALSRequestModule, SharedDelayModule, SharedBLPathModule, SharedIpModule, SharedMaskModule],
})
export class SharedModule {}
