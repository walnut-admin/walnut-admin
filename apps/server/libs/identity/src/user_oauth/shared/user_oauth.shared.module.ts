import { Module } from '@nestjs/common'
import { SysUserOAuthSharedService } from './user_oauth.shared.service'

@Module({
  imports: [],
  controllers: [],
  providers: [SysUserOAuthSharedService],
  exports: [SysUserOAuthSharedService],
})
export class SysUserOAuthSharedModule {}
