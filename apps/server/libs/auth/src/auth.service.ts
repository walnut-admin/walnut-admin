import type { EntityManager } from 'typeorm'
import { Injectable, Logger } from '@nestjs/common'

import { ConfigService } from '@nestjs/config'
import { SysMenuSharedService } from '@walnut-server/system'
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
   * @description sign out —— **凭 RT 认人**（B7 · 批次 7）
   *
   * 入参是「`RT_JTI` cookie + 会话 id + 设备」而不是 AT payload：`POST /auth/signout`
   * 已加 `JwtFree`（AT 过期也要能登出），身份由 `JwtRefreshGuard` 验过的 RT 行给出。
   * 归因/核对（jti → userId·deviceId）在 `AuthSignoutService` 里走共享服务，本层不做数据访问。
   */
  async signoutByRefreshToken(
    session: { jti: string, sid: string, deviceId: string, ip: string },
    em?: EntityManager,
  ) {
    return this.signoutService.signoutByRefreshJti(session, em)
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
