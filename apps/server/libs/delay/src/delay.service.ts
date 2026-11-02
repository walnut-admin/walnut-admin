import { Injectable } from '@nestjs/common'
import { Fn } from 'easy-fns-ts'

@Injectable()
export class SharedDelayService {
  private readonly map = new Map<string, NodeJS.Timeout>()

  /**
   * @description schedule a task to run after timeout
   */
  schedule(uniqueId: string, task: Fn, timeout: number = 3000) {
    this.cancel(uniqueId) // 先清掉旧任务
    const handle = setTimeout(() => {
      this.map.delete(uniqueId)
      try {
        void task()
      }
      catch (e) { console.error(e) }
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
