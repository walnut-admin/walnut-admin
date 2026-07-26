import { Injectable, Logger } from '@nestjs/common'
import { IWalnutAdminConstAppLanguage } from '@walnut-server/const/app/lang'
import { WalnutDBInjectConnection } from '@walnut-server/db'
import { ClientSession, Connection } from 'mongoose'
import { SharedWelcomeService } from '@/modules/shared/welcome/welcome.service'
import { SysUserRepositoryService } from '@/modules/system/user/repo/user.repo.service'
import { SysUserSharedService } from '@/modules/system/user/shared/user.shared.service'
import { AuthSharedService } from '../shared/shared.service'

@Injectable()
export class AuthGoogleService {
  private readonly logger = new Logger(AuthGoogleService.name)

  @WalnutDBInjectConnection()
  readonly dbConnection: Connection

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
    language: IWalnutAdminConstAppLanguage,
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

  async authWithGoogleFedCM(payload: IWalnutAdminAccessTokenPayload, deviceId: string, dbSession: ClientSession) {
    // generate tokens
    return this.authSharedService.generateAuthTokens(payload, deviceId, dbSession)
  }
}
