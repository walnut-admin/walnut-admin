import { Module } from '@nestjs/common'
import { SecurityCapService } from './cap.service'
import { SecurityCapSettingService } from './cap.setting.service'

@Module({
  imports: [],
  providers: [SecurityCapService, SecurityCapSettingService],
  exports: [SecurityCapService],
})
export class SecurityCapModule {}
