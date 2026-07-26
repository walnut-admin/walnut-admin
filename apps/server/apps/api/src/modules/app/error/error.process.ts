import { Process, Processor } from '@nestjs/bull'
import { Logger } from '@nestjs/common'
import { WalnutAdminConstAppProcess } from '@walnut/const/app/process'
import { WalnutAdminConstAppQueue } from '@walnut/const/app/queue'
import { Job } from 'bull'
import { Types } from 'mongoose'
import { WalnutAdminCommonBasicProcessor } from '@/common/processor/base.processor'
import { AppErrorDTOSafe } from './error.dto'
import { AppErrorService } from './error.service'

@Processor(WalnutAdminConstAppQueue.ERROR)
export class AppErrorProcessor extends WalnutAdminCommonBasicProcessor {
  protected readonly logger = new Logger(this.constructor.name)

  constructor(private readonly appErrorService: AppErrorService) {
    super()
  }

  // app error insert
  @Process(WalnutAdminConstAppProcess.APP_ERROR)
  async InsertErrorIntoDB(job: Job<Partial<AppErrorDTOSafe>>) {
    const payload = job.data

    payload.userId = new Types.ObjectId(payload.userId)

    try {
      await this.appErrorService.insertToDB(payload)
    }
    catch {
      return false
    }

    return true
  }
}
