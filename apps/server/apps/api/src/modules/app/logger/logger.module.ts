import { Module } from '@nestjs/common'
import { AppLoggerController } from './logger.controller'
import { AppLoggerService } from './logger.service'

@Module({
  imports: [],
  controllers: [AppLoggerController],
  providers: [AppLoggerService],
  exports: [AppLoggerService],
})
export class AppLoggerModule {}
