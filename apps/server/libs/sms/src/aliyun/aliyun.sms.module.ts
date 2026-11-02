import { Module } from '@nestjs/common'

import { AliyunSmsService } from './aliyun.sms.service'

@Module({
  providers: [AliyunSmsService],
  exports: [AliyunSmsService],
})
export class AliyunSmsModule {}
