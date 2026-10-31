import { Module } from '@nestjs/common'
import { AuthSharedModule } from '../shared/shared.module'
import { AuthGoogleService } from './google.service'
import { AuthGoogleStrategy } from './google.strategy'

@Module({
  imports: [
    AuthSharedModule,
  ],
  providers: [AuthGoogleService, AuthGoogleStrategy],
  exports: [AuthGoogleService],
})
export class AuthGoogleModule {}
