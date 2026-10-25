import type { EntityManager } from 'typeorm'
import { Injectable, Logger } from '@nestjs/common'
import { LocaleType } from '@walnut/contract'
import { SharedWelcomeService } from '@/modules/shared/welcome/welcome.service'
import { SysUserRepositoryService } from '@/modules/system/user/repo/user.repo.service'
import { SysUserSharedService } from '@/modules/system/user/shared/user.shared.service'
import { AuthSharedService } from '../shared/shared.service'

/**
 * B7c 对齐收口：摘除残留的 Mongo 连接注入（`@WalnutDBInjectConnection()
 * readonly dbConnection: Connection`，B7a 起 google 数据腿全在 PG，该注入已无消费方
 * —— auth 链内不允许残留 Mongo 句柄）。
 */
@Injectable()
export class AuthGoogleService {
  private readonly logger = new Logger(AuthGoogleService.name)

  constructor(
    private readonly sysUserSharedService: SysUserSharedService,
    private readonly sysUserRepoService: SysUserRepositoryService,
    private readonly welcomeService: SharedWelcomeService,
    private readonly authSharedService: AuthSharedService,
  ) {}

  /**
   * @description validate user phone number
   */
  async validateGoogle(
    emailAddress: string,
    language: LocaleType,
    deviceId: string,
  ): Promise<IWalnutAdminTokenUser> {
    // TODO
    // auto signup for new user and get tokens
    const tokenPayload = await this.sysUserSharedService.getAccessTokenPayloadAfterAutomaticSignUpForNonExistUser({ }, deviceId)

    // emit send welcome email event for new user
    void this.welcomeService.sendWelcomeByType('email', emailAddress, language)

    return tokenPayload
    // // check user existence
    // const isExisted = await this.sysUserRepoService.checkUserExistence({
    //   emailAddress,
    // })

    // // user existed
    // if (isExisted) {
    //   return this.sysUserSharedService.getAccessTokenPayloadWhenUserExisted(isExisted, deviceId)
    // }
    // else {
    //   // auto signup for new user and get tokens
    //   const tokenPayload = await this.sysUserSharedService.getAccessTokenPayloadAfterAutomaticSignUpForNonExistUser({ emailAddress }, deviceId)

    //   // emit send welcome email event for new user
    //   void this.welcomeService.sendWelcomeByType('email', emailAddress, language)

    //   return tokenPayload
    // }
  }

  // B7b 签名适配：refresh 写腿迁 PG —— dbSession → em
  async authWithGoogleFedCM(payload: IWalnutAdminAccessTokenPayload, deviceId: string, em?: EntityManager) {
    // generate tokens
    return this.authSharedService.generateAuthTokens(payload, deviceId, em)
  }
}
