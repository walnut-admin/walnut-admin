import { Injectable, Logger } from '@nestjs/common'
import { fireAndForget } from '@walnut-server/utils'
import { Fn } from 'easy-fns-ts'

@Injectable()
export class SharedDelayService {
  private readonly logger = new Logger(SharedDelayService.name)

  private readonly map = new Map<string, NodeJS.Timeout>()

  /**
   * @description schedule a task to run after timeout
   */
  schedule(uniqueId: string, task: Fn, timeout: number = 3000) {
    this.cancel(uniqueId) // 先清掉旧任务
    const handle = setTimeout(() => {
      this.map.delete(uniqueId)
      // F-05：原 try/catch 抓不到异步拒绝（task 可能是 async fn）。经 fireAndForget 收编，
      // 同步抛错与异步 reject 都进日志，不产生 unhandledRejection。
      fireAndForget(Promise.resolve().then(() => task() as unknown), this.logger, 'delay scheduled task')
    }, timeout)
    this.map.set(uniqueId, handle)
  }

  /**
   * @description cancel a scheduled task
   */
  cancel(uniqueId: string) {
    const old = this.map.get(uniqueId)
    if (old) {
      clearTimeout(old)
      this.map.delete(uniqueId)
    }
  }
}
