import { MailerModule } from '@nestjs-modules/mailer'
import { BullModule } from '@nestjs/bull'
import { Module } from '@nestjs/common'
import { WalnutAdminConstAppQueue } from '@walnut-server/const/app/queue'

import { AppMailerConfigService } from './mailer.config.service'
import { AppMailerProcessor } from './mailer.processor'
import { AppMailerService } from './mailer.service'

@Module({
  imports: [
    MailerModule.forRootAsync({
      // MailerAsyncOptions 继承 Pick<ModuleMetadata, 'imports'>，Nest 12 下变成必填
      imports: [],
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
