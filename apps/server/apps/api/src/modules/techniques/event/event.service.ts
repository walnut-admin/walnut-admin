import { Injectable, Logger } from '@nestjs/common'
import { OnEvent } from '@nestjs/event-emitter'
import { WalnutAdminConstAppEvent } from '@walnut-server/const/app/event'
import { SysDeletedPgRepoService } from '@walnut-server/system'

@Injectable()
export class AppTechEventService {
  private readonly logger = new Logger(AppTechEventService.name)

  constructor(private readonly deletedRepoService: SysDeletedPgRepoService) {}

  /**
   * @description: Subscribe delete and bind the log operate id to deleted document
   *
   * F-41：这里是 `@OnEvent(..., { async: true })` —— 事件发射方（软删调用点）已经返回，
   * 监听器抛出的异常**不会**回到任何人手里，只会在 event-emitter 内部变成一个未处理的
   * rejection。所以必须自己 catch 并打 error 日志：否则「软删成功、logOperateId 没回写」
   * 这条链彻底不可观测（回收站里的行没有操作人，且没有任何痕迹）。
   */
  @OnEvent(WalnutAdminConstAppEvent.LOG_OPERATE_DELETE, { async: true })
  async _eventLogOperateDelete(payload: { logOperateId: string, deletedId: string }) {
    this.logger.log('Deleted Log Operate Id Received', payload)

    try {
      await this.deletedRepoService.updateDeletedWithLogOperateId(payload)
    }
    catch (error) {
      // 不回写即审计断链：把 id 一起打出来，运维可按 logOperateId 手工补
      this.logger.error(
        `Failed to bind logOperateId to the soft-deleted row (logOperateId=${payload.logOperateId}, deletedId=${payload.deletedId})`,
        error instanceof Error ? error.stack : String(error),
      )
    }
  }

  /**
   * @description: Same as above, but multiple
   *
   * F-41：同上的可观测性补偿（批量形态）。
   */
  @OnEvent(WalnutAdminConstAppEvent.LOG_OPERATE_DELETE_MANY, { async: true })
  async _eventLogOperateDeleteMany(payload: { logOperateId: string, deletedIds: string }) {
    this.logger.log('Deleted Log Operate Id Received', payload)

    try {
      await this.deletedRepoService.updateDeletedManyWithLogOperateId(payload)
    }
    catch (error) {
      this.logger.error(
        `Failed to bind logOperateId to the soft-deleted rows (logOperateId=${payload.logOperateId}, deletedIds=${payload.deletedIds})`,
        error instanceof Error ? error.stack : String(error),
      )
    }
  }
}
