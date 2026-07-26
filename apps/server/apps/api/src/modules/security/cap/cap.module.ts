import { Module } from '@nestjs/common'
import { SecurityCapController } from './cap.controller'
import { SecurityCapService } from './cap.service'
import { SecurityCapSettingService } from './cap.setting.service'

@Module({
  imports: [],
  controllers: [SecurityCapController],
  providers: [SecurityCapService, SecurityCapSettingService],
  exports: [SecurityCapService],
})
export class SecurityCapModule {}
