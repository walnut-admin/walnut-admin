import { Module } from '@nestjs/common'
import { EventEmitterModule } from '@nestjs/event-emitter'
import { AppTechEventService } from './event.service'

@Module({
  imports: [EventEmitterModule.forRoot()],
  providers: [AppTechEventService],
  exports: [AppTechEventService],
})
export class AppTechEventModule {}
