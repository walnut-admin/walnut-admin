import type { EntityManager } from 'typeorm'
import { Injectable } from '@nestjs/common'
import { SysUserOAuthRepositoryService } from '../repo/user_oauth.repo.service'

/**
 * B7a 迁移：事务句柄 `dbSession: ClientSession` → `em?: EntityManager`（纯透传）。
 */
@Injectable()
export class SysUserOAuthSharedService {
  constructor(
    private readonly sysUserOAuthRepoService: SysUserOAuthRepositoryService,
  ) { }

  /**
   * @description bind oauth info for user
   * @returns new document
   */
  async bindOAuthForUser(userId: string, provider: string, providerId: string, em?: EntityManager) {
    return this.sysUserOAuthRepoService.bindOAuthForUser(userId, provider, providerId, em)
  }
}
