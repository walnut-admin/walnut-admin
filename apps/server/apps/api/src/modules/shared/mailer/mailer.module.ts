import { MailerModule } from '@nestjs-modules/mailer'
import { BullModule } from '@nestjs/bull'
import { Module } from '@nestjs/common'
import { WalnutAdminConstAppQueue } from '@walnut/const/app/queue'

import { AppMailerConfigService } from './mailer.config.service'
import { AppMailerProcessor } from './mailer.processor'
import { AppMailerService } from './mailer.service'

@Module({
  imports: [
    MailerModule.forRootAsync({
      useClass: AppMailerConfigService,
    }),

    BullModule.registerQueue({
      name: WalnutAdminConstAppQueue.EMAIL,
    }),
  ],
  controllers: [],
  providers: [AppMailerService, AppMailerProcessor],
  exports: [AppMailerService],
})
export class AppMailerModule {}
