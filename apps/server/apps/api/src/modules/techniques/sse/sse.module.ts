import { Module } from '@nestjs/common'
import { AppTechSseService } from './sse.service'

@Module({
  providers: [AppTechSseService],
  exports: [AppTechSseService],
})
export class AppTechSseModule {}
