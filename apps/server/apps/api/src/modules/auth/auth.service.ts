import type { EntityManager } from 'typeorm'
import { Injectable, Logger } from '@nestjs/common'

import { ConfigService } from '@nestjs/config'
import { SysMenuSharedService } from '../system/menu/shared/menu.shared.service'
import { AuthSignoutService } from './modules/signout/signout.service'

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name)

  constructor(
    private readonly sysMenuSharedService: SysMenuSharedService,
    private readonly configService: ConfigService,
    private readonly signoutService: AuthSignoutService,
  ) { }

  /**
   * @description sign out（B7b 签名适配：refresh 写腿迁 PG —— dbSession → em）
   */
  async signout(payload: IWalnutAdminAccessTokenPayload, deviceId: string, ip: string, em?: EntityManager) {
    return this.signoutService.doSignout(payload.userId, { trigger: 'user-logout', deviceId, ip, sid: payload.sid! }, em)
  }

  /**
   * @description get current user authorized menus
   */
  async getAuthPermissions(
    user: IWalnutAdminAccessTokenPayload,
    deviceId: string,
  ) {
    return this.sysMenuSharedService.getPermissions(user, deviceId)
  }

  /**
   * @description get crypto key and iv, also vendor service api keys
   */
  async getSecretKeys() {
    const keys = {
      B: this.configService.get<string>('vendor.baidu')!,
    }

    return keys
  }
}
