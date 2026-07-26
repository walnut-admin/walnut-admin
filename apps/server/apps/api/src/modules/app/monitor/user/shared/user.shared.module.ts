import { Module } from '@nestjs/common'
import { AppMonitorUserSharedService } from './user.shared.service'

@Module({
  imports: [],
  controllers: [],
  providers: [AppMonitorUserSharedService],
  exports: [AppMonitorUserSharedService],
})
export class AppMonitorUserSharedModule { }
