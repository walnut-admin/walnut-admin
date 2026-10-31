import type { IWalnutAdminTokenTtl } from '@walnut-server/cache'
import type { IWalnutAdminAccessTokenPayloadInput } from './access-token-payload.types'
import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { JwtService } from '@nestjs/jwt'
import { WalnutAdminConstAppTokenKey } from '@walnut-server/const/app/token'
import { RoleType } from '@walnut/contract'
import { nanoid } from 'nanoid'

// implements 是端口绑定的编译期守护（对齐批 1 AppErrorService 的先例）：两个 TTL getter
// 任一改名，这里立刻红，而不是等 useExisting 别名在运行期解析出 undefined
@Injectable()
export class AppTokenService implements IWalnutAdminTokenTtl {
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
   * （B7a：入参从 Mongo document 换成 PG 实体 + junction 组装的 roles_list）
   * （批 4：入参收窄为 lib 内的结构类型 IWalnutAdminAccessTokenPayloadInput ——
   * app 的 SysUserEntity / ISysUserPopulated 结构上天然满足，调用点由 tsc 守护）
   */
  async getJwtAccessTokenPayload(
    user: IWalnutAdminAccessTokenPayloadInput,
    { isTrusted }: { isTrusted: boolean },
  ): Promise<IWalnutAdminAccessTokenPayload> {
    const { id, roles_list, userName, currentRole, roleMode, mfaSetup } = user

    const userId = id

    return {
      userId,
      // 实体列可空（user_name nullable），token 契约要 string —— Mongo 版运行时同样可能
      // 带 null，这里只做类型收窄不改行为
      userName: userName as string,
      roleIds: roles_list?.map(i => i.id) || [],
      roleNames: roles_list?.map(i => i.roleName.toString()) as RoleType[],
      currentRole: currentRole as string,
      roleMode,
      currentRoleName: roles_list?.find(i => i.id === currentRole)?.roleName as RoleType,
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
