import { Module } from '@nestjs/common'

import { AppMailerModule } from '../mailer/mailer.module'
import { AppSmsModule } from '../sms/sms.module'
import { SharedWelcomeService } from './welcome.service'

@Module({
  imports: [AppMailerModule, AppSmsModule],
  controllers: [],
  providers: [SharedWelcomeService],
  exports: [SharedWelcomeService],
})
export class SharedWelcomeModule { }
