import { Buffer } from 'node:buffer'
import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { PassportStrategy } from '@nestjs/passport'

import { WalnutAdminConstCookieKeys } from '@walnut/const/app/cookie'
import { WalnutAdminConstAppAuthStrategy } from '@walnut/const/app/strategy'
import { WalnutAdminExceptionOAuthFailed } from '@walnut/exceptions/business/auth'
import { Recordable } from 'easy-fns-ts'
import { importJWK, JWTPayload, jwtVerify } from 'jose'
import { Strategy } from 'passport-local'
import { getWalnutAdminCookie } from '@/decorators/walnut/cookie.decorator'
// https://www.googleapis.com/oauth2/v3/certs
import googleJwk from '../../../../public/json/google-jwk.json'
import { AuthGoogleService } from './google.service'

@Injectable()
export class AuthGoogleStrategy extends PassportStrategy(
  Strategy,
  WalnutAdminConstAppAuthStrategy.OAUTH_GOOGLE_FED_CM,
) {
  private readonly logger = new Logger(AuthGoogleStrategy.name)

  private keys: Record<string, CryptoKey> = {}

  constructor(private readonly configService: ConfigService, private readonly authGoogleService: AuthGoogleService) {
    super({
      passReqToCallback: true,
      usernameField: 'credential',
      passwordField: 'credential',
    })

    for (const jwk of googleJwk.keys) {
      void importJWK(jwk, 'RS256').then((key) => {
        this.keys[jwk.kid] = key as CryptoKey
      })
    }
  }

  private decodeHeader(idToken: string) {
    try {
      const headerB64 = idToken.split('.')[0]
      const headerJson = Buffer.from(headerB64, 'base64').toString()
      return JSON.parse(headerJson) as Recordable
    }
    catch (error: any) {
      this.logger.error(`decode idToken header failed: ${error}`)
      return null
    }
  }

  async verify(idToken: string) {
    try {
      const header = this.decodeHeader(idToken)!

      const key: CryptoKey = this.keys[header.kid as string]

      if (key === null) {
        throw new Error('Unknown kid, need to update JWKS')
      }

      const clientId = this.configService.get<string>('auth.google.clientId')!

      if (!clientId) {
        throw new Error('Google Client ID is not configured')
      }

      const { payload } = await jwtVerify(idToken, key, {
        issuer: ['https://accounts.google.com', 'accounts.google.com'],
        audience: clientId,
      })

      return payload as JWTPayload & { email: string, name: string }
    }
    catch (error: any) {
      this.logger.error(`verify idToken failed: ${error}`)
      return null
    }
  }

  async validate(
    request: IWalnutAdminExpressRequest,
    credential: string,
    _password: string,
  ) {
    const ticket = await this.verify(credential)

    if (ticket === null) {
      throw new WalnutAdminExceptionOAuthFailed()
    }

    this.logger.log(`validate: ${JSON.stringify(ticket)}`)

    request.identifier = ticket.email

    const deviceId = getWalnutAdminCookie(request, WalnutAdminConstCookieKeys.DEVICE_ID)

    return this.authGoogleService.validateGoogle(ticket.email, request.language, deviceId)
  }
}
