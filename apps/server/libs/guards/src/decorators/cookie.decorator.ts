import type { ExecutionContext } from '@nestjs/common'
import type { IWalnutAdminConstCookieKeys } from '@walnut-server/const/app/cookie'
import { createParamDecorator } from '@nestjs/common'
import { getWalnutAdminCookie } from '@walnut-server/cookie'

// 批 4：getWalnutAdminCookie 已迁入 @walnut-server/cookie（操作日志拦截器随 libs/crud
// 下沉后需要在 lib 内共用）；此处保留再导出，app 侧既有导入零改动
export { getWalnutAdminCookie }

export const WalnutAdminDecoratorCookie = createParamDecorator(
  (key: IWalnutAdminConstCookieKeys, ctx: ExecutionContext): string => {
    const request = ctx.switchToHttp().getRequest<IWalnutAdminExpressRequest>()
    return getWalnutAdminCookie(request, key)
  },
)
