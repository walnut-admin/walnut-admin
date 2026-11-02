import { ExecutionContext, Injectable, SetMetadata } from '@nestjs/common'

import { Reflector } from '@nestjs/core'
import { AuthGuard } from '@nestjs/passport'

import { WalnutAdminConstAppAuthStrategy } from '@walnut-server/const/app/strategy'
import { WalnutAdminExceptionAccessTokenExpired } from '@walnut-server/exceptions/business/auth'
import { isNil } from 'lodash'

export const WalnutAdminConstDecoratorJwtFreeKey = Symbol('WALNUT_ADMIN_CONST_DECORATOR_JWT_FREE')

/**
 * 「可带 access token，也可匿名」的 handler 标记（`@WalnutAdminGuardJwtOptional()`）。
 *
 * 批次6-B 起**导出**：文档组装点（apps/api 的 swagger.document.ts）要按它把这类 operation
 * 声明成 `security: [{ bearer: [] }, {}]`（OpenAPI 里数组即「或」：带 bearer 或匿名都行）。
 * 先前它是模块私有 Symbol，读不到 ⇒ user_preference 这类端点在文档里被写成受保护。
 * 与 `JwtFree` 的区别：Free 是「完全不做 JWT 认证」，Optional 是「做了认证但不强制」。
 */
export const WalnutAdminConstDecoratorJwtOptionalKey = Symbol(
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
    // Optional 模式：无用户或出错时返回 null
    if (isOptional) {
      if (!isNil(err) || isNil(user)) {
        return null
      }
      return user
    }

    // Default 模式：无用户或出错时抛异常
    if (!isNil(err) || isNil(user) || user === false) {
      throw new WalnutAdminExceptionAccessTokenExpired()
    }

    return user
  }
}
