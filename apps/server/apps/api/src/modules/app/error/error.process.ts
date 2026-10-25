import { Process, Processor } from '@nestjs/bull'
import { Logger } from '@nestjs/common'
import { WalnutAdminConstAppProcess } from '@walnut-server/const/app/process'
import { WalnutAdminConstAppQueue } from '@walnut-server/const/app/queue'
import { Job } from 'bull'
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

    // B1 迁 PG（phase3-plan §4）：user_id 是 uuid 松引用，userId 原样直传；
    // 原 `new Types.ObjectId(payload.userId)` 包装随迁移删除

    try {
      await this.appErrorService.insertToDB(payload)
    }
    catch {
      return false
    }

    return true
  }
}
