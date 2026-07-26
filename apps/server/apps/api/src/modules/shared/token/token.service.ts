import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { JwtService } from '@nestjs/jwt'
import { WalnutAdminConstAppTokenKey } from '@walnut/const/app/token'
import { IWalnutAdminConstRole } from '@walnut/const/role/index'
import { nanoid } from 'nanoid'
import { ISysUserDocument } from '@/modules/system/user/schema/user.schema'

@Injectable()
export class AppTokenService {
  private readonly logger = new Logger(AppTokenService.name)

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) { }

  /**
   * @description generate token jti
   */
  async generateJTI() {
    return nanoid(24)
  }

  /**
   * @description get access token secret
   */
  private getAccessTokenSecret() {
    return this.configService.get<string>('jwt.access.secret')!
  }

  /**
   * @description get access token expire seconds
   */
  getAccessTokenExpireSeconds() {
    return this.configService.get<number>('jwt.access.expire')!
  }

  /**
   * @description get refresh token secret
   */
  private getRefreshTokenSecret() {
    return this.configService.get<string>('jwt.refresh.secret')!
  }

  /**
   * @description get refresh token expire seconds
   */
  getRefreshTokenExpireSeconds() {
    return this.configService.get<number>('jwt.refresh.expire')!
  }

  /**
   * @description generate simple jwt refresh token with jti sign
   */
  async generateJwtRefreshToken(jti: string, sid: string) {
    return this.jwtService.signAsync(
      { jti, sid },
      {
        secret: this.getRefreshTokenSecret(),
        expiresIn: `${this.getRefreshTokenExpireSeconds()}s`,
      },
    )
  }

  /**
   * @description get access token
   */
  async generateJwtAccessToken(payload: IWalnutAdminAccessTokenPayload) {
    return this.jwtService.signAsync(
      Object.assign(payload, { key: WalnutAdminConstAppTokenKey.ACCESS }),
      {
        secret: this.getAccessTokenSecret(),
        expiresIn: `${this.getAccessTokenExpireSeconds()}s`,
      },
    )
  }

  /**
   * @description get access token payload
   */
  async getJwtAccessTokenPayload(
    user: ISysUserDocument,
    { isTrusted }: { isTrusted: boolean },
  ): Promise<IWalnutAdminAccessTokenPayload> {
    const { _id, populated_roles_list, userName, currentRole, roleMode, mfaSetup } = user

    const userId = _id.toString()

    return {
      userId,
      userName,
      roleIds: populated_roles_list?.map(i => i._id.toString()) || [],
      roleNames: populated_roles_list?.map(i => i.roleName.toString()) as IWalnutAdminConstRole[],
      currentRole: currentRole.toString(),
      roleMode,
      currentRoleName: populated_roles_list?.find(i => i._id.toString() === currentRole.toString())?.roleName as IWalnutAdminConstRole,
      mfaSetup,
      mfaVerified: isTrusted,
    }
  }

  /**
   * @description decode access token
   */
  async decodeAccessToken(token: string): Promise<IWalnutAdminAccessTokenPayload | null> {
    try {
      return await this.jwtService.decode(token)
    }
    catch (error) {
      this.logger.error(error)
      return null
    }
  }
}
