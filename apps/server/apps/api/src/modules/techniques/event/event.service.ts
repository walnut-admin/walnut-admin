import { Injectable, Logger } from '@nestjs/common'
import { OnEvent } from '@nestjs/event-emitter'
import { WalnutAdminConstAppEvent } from '@walnut-server/const/app/event'
import { SysDeletedRepoService } from '@/modules/system/deleted/repo/deleted.repo.service'

@Injectable()
export class AppTechEventService {
  private readonly logger = new Logger(AppTechEventService.name)

  constructor(private readonly deletedRepoService: SysDeletedRepoService) {}

  /**
   * @description: Subscribe delete and bind the log operate id to deleted document
   */
  @OnEvent(WalnutAdminConstAppEvent.LOG_OPERATE_DELETE, { async: true })
  async _eventLogOperateDelete(payload: { logOperateId: string, deletedId: string }) {
    this.logger.log('Deleted Log Operate Id Received', payload)
    await this.deletedRepoService.updateDeletedWithLogOperateId(payload)
  }

  /**
   * @description: Same as above, but multiple
   */
  @OnEvent(WalnutAdminConstAppEvent.LOG_OPERATE_DELETE_MANY, { async: true })
  async _eventLogOperateDeleteMany(payload: { logOperateId: string, deletedIds: string }) {
    this.logger.log('Deleted Log Operate Id Received', payload)
    await this.deletedRepoService.updateDeletedManyWithLogOperateId(payload)
  }
}
