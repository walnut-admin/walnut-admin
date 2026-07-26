import { HttpModule } from '@nestjs/axios'
import { Module } from '@nestjs/common'
import { TerminusModule } from '@nestjs/terminus'

import { AppTechHealthController } from './health.controller'

@Module({
  imports: [TerminusModule, HttpModule],
  controllers: [AppTechHealthController],
})
export class AppTechHealthModule {}
