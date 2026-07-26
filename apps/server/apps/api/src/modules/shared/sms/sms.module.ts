import { BullModule } from '@nestjs/bull'
import { Module } from '@nestjs/common'
import { WalnutAdminConstAppQueue } from '@walnut/const/app/queue'

import { AliyunSmsModule } from './aliyun/aliyun.sms.module'
import { AppSmsProcessor } from './sms.processor'
import { AppSmsService } from './sms.service'

@Module({
  imports: [
    BullModule.registerQueue({
      name: WalnutAdminConstAppQueue.PHONE,
    }),
    AliyunSmsModule,
  ],
  controllers: [],
  providers: [AppSmsService, AppSmsProcessor],
  exports: [AppSmsService],
})
export class AppSmsModule {}
