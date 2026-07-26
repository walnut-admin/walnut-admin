import { Global, Module } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { SysLogAuthRepoModule } from '../repo/log.auth.repo.module'
import { SysLogAuthSharedService } from './log.auth.shared.service'

/**
 * SysLogAuthSharedModule
 *
 * Global module providing shared auth log functionality.
 * Used by decorators and guards across the application.
 */
@Global()
@Module({
  imports: [SysLogAuthRepoModule],
  providers: [SysLogAuthSharedService, Reflector],
  exports: [SysLogAuthSharedService],
})
export class SysLogAuthSharedModule {}
