import { Module } from '@nestjs/common'
import { SysUserLockSharedService } from './user_lock.shared.service'

@Module({
  imports: [],
  controllers: [],
  providers: [SysUserLockSharedService],
  exports: [SysUserLockSharedService],
})
export class SysUserLockSharedModule {}
