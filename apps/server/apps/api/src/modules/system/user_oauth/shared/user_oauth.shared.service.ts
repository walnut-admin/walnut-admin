import type { ClientSession } from 'mongoose'
import { Injectable, Logger } from '@nestjs/common'
import { SysUserOAuthRepositoryService } from '../repo/user_oauth.repo.service'

@Injectable()
export class SysUserOAuthSharedService {
  private readonly logger = new Logger(SysUserOAuthSharedService.name)

  constructor(
    private readonly sysUserOAuthRepoService: SysUserOAuthRepositoryService,
  ) { }

  /**
   * @description bind oauth info for user
   * @returns new document
   */
  async bindOAuthForUser(userId: string, provider: string, providerId: string, dbSession: ClientSession) {
    return this.sysUserOAuthRepoService.bindOAuthForUser(userId, provider, providerId, dbSession)
  }
}
