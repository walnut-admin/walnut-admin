import { Module } from '@nestjs/common'
import { AppALSRequestModule } from '@walnut-server/als'
import { SharedBLPathModule } from '@walnut-server/blpath'
import { SharedDelayModule } from '@walnut-server/delay'
import { SharedIpModule } from '@walnut-server/ip'
import { AppTokenModule } from '@walnut-server/token'
import { SharedAliModule } from './ali/ali.module'
import { SharedAreaModule } from './area/area.module'
import { SharedMaskModule } from './mask/mask.module'

@Module({
  imports: [AppTokenModule, SharedAliModule, SharedAreaModule, AppALSRequestModule, SharedDelayModule, SharedBLPathModule, SharedIpModule, SharedMaskModule],
})
export class SharedModule {}
