import { Module } from '@nestjs/common'

import { AppMailerModule } from '@walnut-server/mailer'
import { AppSmsModule } from '@walnut-server/sms'
import { SharedWelcomeService } from './welcome.service'

@Module({
  imports: [AppMailerModule, AppSmsModule],
  controllers: [],
  providers: [SharedWelcomeService],
  exports: [SharedWelcomeService],
})
export class SharedWelcomeModule { }
