import { Injectable, Logger } from '@nestjs/common'
import * as opaque from '@serenity-kit/opaque'
import { WalnutAdminExceptionInvalidCredential } from '@walnut-server/exceptions/business/auth'
import { isNil } from 'lodash'
import { SysUserRepositoryService } from '@/modules/system/user/repo/user.repo.service'
import { SysUserSharedService } from '@/modules/system/user/shared/user.shared.service'
import { AppTechCacheOpaqueService } from '@/modules/techniques/cache/service/cache.opaque'
import { AuthOpaqueCoreService } from '../core/opaque.core.service'

/**
 * OPAQUE (Oblivious Pseudorandom Function) authentication service
 * Implements password-authenticated key exchange protocol that never exposes passwords to the server
 */
@Injectable()
export class AuthOpaqueUserService {
  private readonly logger = new Logger(AuthOpaqueUserService.name)

  constructor(
    private readonly opaqueCacheService: AppTechCacheOpaqueService,

    private readonly sysUserSharedService: SysUserSharedService,
    private readonly opaqueCoreService: AuthOpaqueCoreService,
    private readonly userRepo: SysUserRepositoryService,
  ) {
  }

  /**
   * Validate OPAQUE user credentials (Step 2 of 2)
   * Completes the OPAQUE login flow by verifying client's finish request
   */
  async validateOpaqueUser(userName: string, finishLoginRequest: string, deviceId: string) {
    // Retrieve cached server login state from step 1
    const serverLoginState = await this.opaqueCacheService.getOpaqueServerStateCache(userName, deviceId)
    if (isNil(serverLoginState)) {
      throw new WalnutAdminExceptionInvalidCredential()
    }

    // Find user again to ensure they still exist
    const user = await this.userRepo.findUserByUserName(userName)
    if (!user) {
      throw new WalnutAdminExceptionInvalidCredential()
    }

    try {
      // Server completes login verification and derives shared session key
      const { sessionKey } = opaque.server.finishLogin({
        finishLoginRequest,
        serverLoginState,
        identifiers: {
          client: user.userName,
          server: this.opaqueCoreService.getAppName(),
        },
      })

      // Cache session key temporarily for final token generation step
      await this.opaqueCacheService.setOpaqueSessionKeyCache(userName, deviceId, sessionKey)

      // Return user's access token payload
      return await this.sysUserSharedService.getAccessTokenPayloadWhenUserExisted(user, deviceId)
    }
    catch (error: any) {
      this.logger.error(`OPAQUE login finish failed, userName: ${userName}, error: ${error}`)
      throw new WalnutAdminExceptionInvalidCredential()
    }
    finally {
      // Clean up server login state regardless of success or failure
      await this.opaqueCacheService.delOpaqueServerStateCache(userName, deviceId)
    }
  }
}
