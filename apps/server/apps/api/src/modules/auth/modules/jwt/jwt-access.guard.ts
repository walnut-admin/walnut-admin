import { ExecutionContext, Injectable, SetMetadata } from '@nestjs/common'

import { Reflector } from '@nestjs/core'
import { AuthGuard } from '@nestjs/passport'

import { WalnutAdminConstAppAuthStrategy } from '@walnut/const/app/strategy'
import { WalnutAdminExceptionAccessTokenExpired } from '@walnut/exceptions/business/auth'
import { isNil } from 'lodash'

export const WalnutAdminConstDecoratorJwtFreeKey = Symbol('WALNUT_ADMIN_CONST_DECORATOR_JWT_FREE')
const WalnutAdminConstDecoratorJwtOptionalKey = Symbol(
  'WALNUT_ADMIN_CONST_DECORATOR_JWT_OPTIONAL',
)

export function WalnutAdminGuardJwtFree() {
  return SetMetadata(WalnutAdminConstDecoratorJwtFreeKey, true)
}
export function WalnutAdminGuardJwtOptional() {
  return SetMetadata(WalnutAdminConstDecoratorJwtOptionalKey, true)
}

@Injectable()
export class JwtAccessGuard extends AuthGuard(
  WalnutAdminConstAppAuthStrategy.JWT_ACCESS_TOKEN,
) {
  constructor(private readonly reflector: Reflector) {
    super()
  }

  canActivate(context: ExecutionContext): boolean | Promise<boolean> | import('rxjs').Observable<boolean> {
    // Used for public api which do not need auth
    const isPublic = this.reflector.getAllAndOverride<boolean>(
      WalnutAdminConstDecoratorJwtFreeKey,
      [context.getHandler(), context.getClass()],
    )

    if (isPublic) {
      return true
    }

    // Add your custom authentication logic here
    // for example, call super.logIn(request) to establish a session.
    return super.canActivate(context)
  }

  handleRequest<TUser>(err: any, user: TUser, _info: any, context: ExecutionContext): TUser | null {
    //  Check if the route is marked as optional
    const isOptional = this.reflector.getAllAndOverride<boolean>(
      WalnutAdminConstDecoratorJwtOptionalKey,
      [context.getHandler(), context.getClass()],
    )
    // �?Optional mode: return null if no user or error
    if (isOptional) {
      if (!isNil(err) || isNil(user)) {
        return null
      }
      return user
    }

    // �?Default mode: throw error if no user or error
    if (!isNil(err) || isNil(user) || user === false) {
      throw new WalnutAdminExceptionAccessTokenExpired()
    }

    return user
  }
}
