import { Module } from '@nestjs/common'
import { AuthSharedModule } from '../shared/shared.module'
import { AuthGoogleController } from './google.controller'
import { AuthGoogleService } from './google.service'
import { AuthGoogleStrategy } from './google.strategy'

@Module({
  imports: [
    AuthSharedModule,
  ],
  controllers: [AuthGoogleController],
  providers: [AuthGoogleService, AuthGoogleStrategy],
  exports: [AuthGoogleService],
})
export class AuthGoogleModule {}
