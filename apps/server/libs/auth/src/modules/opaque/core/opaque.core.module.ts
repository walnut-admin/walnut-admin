import { Module } from '@nestjs/common'
import { AuthSharedModule } from '../../shared/shared.module'
import { AuthOpaqueCoreService } from '../core/opaque.core.service'

@Module({
  imports: [AuthSharedModule],
  controllers: [],
  providers: [AuthOpaqueCoreService],
  exports: [AuthOpaqueCoreService],
})
export class AuthOpaqueCoreModule {}
