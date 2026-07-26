import { Module } from '@nestjs/common'
import { AppMonitorUserSharedModule } from '@/modules/app/monitor/user/shared/user.shared.module'
import { SysUserLockSharedService } from './user_lock.shared.service'

@Module({
  imports: [AppMonitorUserSharedModule],
  controllers: [],
  providers: [SysUserLockSharedService],
  exports: [SysUserLockSharedService],
})
export class SysUserLockSharedModule {}
